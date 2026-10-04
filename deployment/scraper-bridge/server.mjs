import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { upstream } from './providerProxy.mjs';
import { sourceIsUsable } from './source-validation.mjs';
const api = process.env.NUVIO_SUPABASE_URL;
const key = process.env.NUVIO_SUPABASE_ANON_KEY;
const allowed = new Set((process.env.NUVIO_PROVIDER_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean));
const cache = new Map();
const assets = new Map();
let active = 0;
const waiting = [];
async function slot(task) {
  if (active >= 4) await new Promise(resolve => waiting.push(resolve));
  active++;
  try { return await task(); } finally { active--; waiting.shift()?.(); }
}
async function backend(path, token, body) {
  const response = await fetch(`${api}${path}`, { headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? {method: 'POST', body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Object.assign(new Error('Account request failed'), {status: response.status === 401 ? 401 : 502});
  return response.json();
}
async function github(raw) {
  const url = new URL(raw.replace('/D3adlyRocket/All-in-One-Nuvio/', '/NuvioPlugin/All-in-One-Nuvio/'));
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.username || url.password) throw new Error('Unsupported plugin repository');
  const hit = assets.get(url.href);
  if (hit && Date.now() - hit.at < 300000) return hit.value;
  const response = await fetch(url, {signal: AbortSignal.timeout(10000), redirect: 'error'});
  if (!response.ok) throw new Error('Plugin download failed');
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  while (true) { const {value,done} = await reader.read(); if(done) break; size += value.length; if(size > 5*1024*1024) { await reader.cancel(); throw new Error('Plugin too large'); } chunks.push(Buffer.from(value)); }
  const value = Buffer.concat(chunks).toString('utf8');
  if (assets.size >= 100) assets.delete(assets.keys().next().value);
  assets.set(url.href, {at: Date.now(), value});
  return value;
}
function execute(code, scraper, args) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {execArgv: []});
    let finished = false;
    const finish = results => { if(finished) return; finished = true; clearTimeout(timer); worker.terminate(); resolve(results); };
    const timer = setTimeout(() => finish([]), 22000);
    worker.on('error', () => finish([]));
    worker.on('exit', () => finish([]));
    worker.on('message', async message => {
      if (message.type === 'result') finish(message.results || []);
      else if (message.type === 'error') finish([]);
      else if (message.type === 'fetch') {
        let payload;
        try { payload = await upstream(message.payload, allowed); }
        catch { payload = {returnValue:true,ok:false,status:0,statusText:'Request failed',url:message.payload.url,body:'',headers:{},truncated:false}; }
        if (!finished) worker.postMessage({type:'fetchResult',requestId:message.requestId,payload});
      }
    });
    worker.postMessage({type:'execute',code,filename:scraper.filename,scraperId:scraper.id,settings:{},args,timeoutMs:20000,quota:{memoryLimitBytes:64*1024*1024,maxCodeBytes:5*1024*1024,maxResultsPerScraper:30,maxDocuments:4,maxDomElements:10000}});
  });
}
async function lookup(type, id) {
  const [base,season,episode] = id.split(':');
  let tmdbId;
  if (base === 'tmdb') tmdbId = season;
  else if (/^\d+$/.test(base)) tmdbId = base;
  else {
    if (!/^tt\d+$/.test(base)) throw new Error('Unsupported title ID');
    const response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${base}.json`, {signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new Error('Metadata unavailable');
    const {meta} = await response.json();
    tmdbId = meta?.moviedb_id;
    if (!tmdbId) throw new Error('TMDB ID unavailable');
  }
  return {tmdbId:String(tmdbId),mediaType:type === 'series' ? 'tv' : 'movie',season:type === 'series' ? Number(season || 1) : undefined,episode:type === 'series' ? Number(episode || 1) : undefined};
}
async function search(token, profileId, type, id) {
  const user = await backend('/auth/v1/user', token);
  const [profiles,owner] = await Promise.all([backend('/rest/v1/rpc/sync_pull_profiles',token,{}), backend('/rest/v1/rpc/get_sync_owner',token,{})]);
  const profile = profiles.find(p => Number(p.profile_index ?? p.profile_id ?? p.id) === profileId);
  if (!profile) throw Object.assign(new Error('Unknown profile'), {status:403});
  const effective = profile.uses_primary_plugins ? 1 : profileId;
  const rows = await backend(`/rest/v1/plugins?user_id=eq.${encodeURIComponent(typeof owner === 'string' ? owner : user.id)}&profile_id=eq.${effective}&select=*&order=sort_order.asc`,token);
  const enabled = rows.map(r => ({...r, url:r.url || r.url_template})).filter(r => r.enabled !== false && r.url?.startsWith('https://raw.githubusercontent.com/'));
  const fingerprint = createHash('sha256').update(JSON.stringify(enabled)).digest('hex');
  const cacheKey = `${user.id}:${effective}:${fingerprint}:${type}:${id}`;
  for(const [k,v] of cache) { if(Date.now()-v.at>300000) cache.delete(k); }
  let entry = cache.get(cacheKey);
  if(!entry) {
    if(cache.size >= 100 || waiting.length > 100) throw Object.assign(new Error('Search capacity reached'),{status:503});
    entry = {at:Date.now(),streams:[],done:false}; cache.set(cacheKey,entry);
    entry.promise = collect(enabled,type,id,entry).catch(() => {}).finally(() => { entry.done=true; });
  }
  const deadline = Date.now()+1500;
  while(!entry.done && !entry.streams.length && Date.now()<deadline) await new Promise(r => setTimeout(r,100));
  return {streams:entry.streams.slice(),behaviorHints:{searchPending:!entry.done}};
}
async function collect(rows,type,id,entry) {
  const args = await lookup(type,id);
  const manifests = await Promise.allSettled(rows.map(async r => ({url:r.url,manifest:JSON.parse(await github(r.url))})));
  const scrapers = manifests.filter(r=>r.status==='fulfilled').flatMap(r=> (r.value.manifest.scrapers || []).filter(s=>s.enabled !== false && (!s.supportedTypes || s.supportedTypes.includes(args.mediaType))).map(s=>({...s,codeUrl:new URL(s.filename,r.value.url).href})));
  const priority = ['castle','desiflix','movieblast'];
  scrapers.sort((a,b) => (priority.indexOf(a.id)<0?99:priority.indexOf(a.id))-(priority.indexOf(b.id)<0?99:priority.indexOf(b.id)));
  const deadline = Date.now()+90000;
  await Promise.allSettled(scrapers.map(scraper => slot(async () => {
    if(Date.now() > deadline) return;
    const results = await execute(await github(scraper.codeUrl),scraper,args);
    for(const result of results) {
      if(typeof result.url !== 'string' || !await sourceIsUsable(result.url)) continue;
      if(entry.streams.some(s=>s.url === result.url)) continue;
      entry.streams.push({url:result.url,name:result.name || scraper.name || scraper.id,title:result.title || result.quality || scraper.name, ...(result.headers ? {behaviorHints:{notWebReady:false,proxyHeaders:{request:result.headers}}} : {})});
    }
  })));
  console.log(JSON.stringify({event:'search_completed',providers:scrapers.length,streams:entry.streams.length}));
}
const manifest = {id:'local.nuvio.scrapers',version:'0.1.0',name:'Nuvio native scrapers',description:'Installed native repositories, isolated scraper engine',resources:[{name:'stream',types:['movie','series'],idPrefixes:['tt','tmdb:']}],types:['movie','series'],catalogs:[]};
http.createServer(async (request,response) => {
  const send = (status,value) => {response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
  try {
    const url = new URL(request.url,'http://bridge');
    if(request.method !== 'GET') return send(405,{error:'GET required'});
    if(url.pathname === '/health') return send(200,{ok:true,active,queued:waiting.length});
    if(url.pathname === '/manifest.json') return send(200,manifest);
    const match = url.pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
    if(!match) return send(404,{error:'Unknown endpoint'});
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if(!token) return send(401,{error:'Sign-in required'});
    const profile = Number(request.headers['x-nuvio-profile']);
    if(!Number.isInteger(profile) || profile<1 || profile>6) return send(400,{error:'Invalid profile'});
    return send(200,await search(token,profile,match[1],decodeURIComponent(match[2])));
  } catch(error) { return send(error.status || 502,{error:error.status === 401 ? 'Session expired' : 'Scraper request failed'}); }
}).listen(3000,'0.0.0.0');
