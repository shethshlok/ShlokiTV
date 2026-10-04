import { createRequire } from 'node:module';
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
const runtime = new URL('./vendor/runtime/', import.meta.url);
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = new URL("./vendor/libs/", import.meta.url).pathname;
globalThis.self = globalThis;
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.importScripts = (...paths) => {
  for (const path of paths) runInThisContext(readFileSync(new URL(path, runtime), 'utf8'), { filename: path });
};
runInThisContext(readFileSync(new URL('plugin-worker.js', runtime), 'utf8'), { filename: 'plugin-worker.js' });
parentPort.on('message', (data) => globalThis.onmessage({ data }));
