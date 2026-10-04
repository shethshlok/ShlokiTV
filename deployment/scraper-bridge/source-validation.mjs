import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicIPv4 } from './providerProxy.mjs';
const hosts = new Map();
function publicAddress(address) {
  if (isIP(address) === 4) return isPublicIPv4(address);
  // Globally routed IPv6 unicast is 2000::/3; exclude documentation addresses.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:0?db8:/i.test(address);
}
export async function sourceIsUsable(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  // The HTTPS site cannot load insecure media or private network destinations.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname;
  if (isIP(host)) return publicAddress(host);
  const hit = hosts.get(host);
  if (hit && Date.now() < hit.expires) return hit.promise;
  if (hosts.size >= 500) hosts.delete(hosts.keys().next().value);
  const entry = {expires:Date.now()+300000,promise:null};
  entry.promise = (async () => {
    let timer;
    try {
      const addresses = await Promise.race([
        lookup(host, {all:true}),
        new Promise((_,reject) => { timer=setTimeout(()=>reject(new Error('DNS timeout')),3000); }),
      ]);
      const ok = addresses.length > 0 && addresses.every(({address}) => publicAddress(address));
      if (!ok) entry.expires=Date.now()+30000;
      return ok;
    } catch { entry.expires=Date.now()+30000; return false; }
    finally { clearTimeout(timer); }
  })();
  hosts.set(host,entry);
  return entry.promise;
}
