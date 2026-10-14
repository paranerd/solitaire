import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const directory = path.resolve('dist');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.name !== 'sw.js') files.push(file);
  }
  return files.sort();
}
const files = await walk(directory);
const hash = createHash('sha256');
for (const file of files) { hash.update(path.relative(directory, file)); hash.update(await readFile(file)); }
const cacheName = `solitaire-${hash.digest('hex').slice(0, 16)}`;
const urls = ['./', ...files.map(f => './' + path.relative(directory, f).replaceAll(path.sep, '/'))];
const source = `// Generated from the complete build. No network dependencies.
const CACHE = ${JSON.stringify(cacheName)};
const FILES = ${JSON.stringify(urls)};
const ROOT = new URL('./', self.location.href).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('solitaire-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') return (await cache.match(ROOT)) || (await cache.match(new URL('index.html', ROOT))) || fetch(event.request);
    // Static assets are identical for every request origin/header combination.
    const stored = await cache.match(event.request, { ignoreSearch: true, ignoreVary: true });
    return stored || fetch(event.request);
  })());
});
`;
await writeFile(path.join(directory, 'sw.js'), source);
console.log(`Offline cache: ${files.length} assets, ${cacheName}`);
