/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v91';
const SHELL = ["./","./access-activity.js?v=91","./access-logs.js?v=91","./account-acronym.js?v=91","./account-setup.js?v=91","./animal-sheet-export.js?v=91","./animal-sheet-import.js?v=91","./app.js?v=91","./archive-format.js?v=91","./brainbot.js?v=91","./breeding-options.js?v=91","./breeding-planner.js?v=91","./breeding-summary.js?v=91","./cage-history.js?v=91","./cage-label.js?v=91","./cage-managers.js?v=91","./cage-movement.js?v=91","./cage-observations.js?v=91","./cage-sheet.js?v=91","./cage-start.js?v=91","./cage-summary-options.js?v=91","./cage-summary.js?v=91","./config.js?v=91","./cryo-sources.js?v=91","./cryopreservation-model.js?v=91","./cryopreservation.js?v=91","./data-store.js?v=91","./experiment-model.js?v=91","./experiment-source-timing.js?v=91","./experiment-sources.js?v=91","./experiment-timing.js?v=91","./experiments.js?v=91","./export-center.js?v=91","./family-explorer.js?v=91","./family-genotypes.js?v=91","./family-targets.js?v=91","./genetics.js?v=91","./genotype-catalog.js?v=91","./genotype-schema.js?v=91","./history-index.js?v=91","./husbandry.js?v=91","./iacuc-model.js?v=91","./iacuc-planning.js?v=91","./iacuc.js?v=91","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=91","./lac-fee-model.js?v=91","./lac-fee-occupancy.js?v=91","./lac-fees.js?v=91","./litter-summary.js?v=91","./local-backup.js?v=91","./locobox-export.js?v=91","./locobox-label.js?v=91","./locobox-model.js?v=91","./locobox.js?v=91","./manifest.webmanifest","./model.js?v=91","./mouse-registration.js?v=91","./mouse-review-view.js?v=91","./mouse-review.js?v=91","./mouse-summary.js?v=91","./overview-summary.js?v=91","./permissions.js?v=91","./room-order.js?v=91","./site-migration.js?v=91","./strain-management.js?v=91","./strain-registry.js?v=91","./styles.css?v=91","./user-acronyms.js?v=91","./user-management.js?v=91","./workbook-export.js?v=91"];
const allowed = new Set(SHELL.map(path => new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('colony-shell-')&&name!==CACHE).map(name=>caches.delete(name)));
  const cache=await caches.open(CACHE),requests=await cache.keys();
  await Promise.all(requests.filter(request=>!allowed.has(request.url)).map(request=>cache.delete(request)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!allowed.has(event.request.url))return;
  const network=()=>fetch(event.request).then(response=>{
    if(response.ok&&response.type==='basic'){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
    }
    return response;
  }).catch(()=>caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||Response.error()));
  const url=new URL(event.request.url);
  // Exact release URLs are immutable within this cache. HTML stays network-first
  // so a new release is discovered; private requests never match the allowlist.
  event.respondWith(url.searchParams.has('v')?caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||network()):network());
});
