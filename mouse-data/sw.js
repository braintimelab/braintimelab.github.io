/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v93';
const SHELL = ["./","./access-activity.js?v=93","./access-logs.js?v=93","./account-acronym.js?v=93","./account-setup.js?v=93","./animal-sheet-export.js?v=93","./animal-sheet-import.js?v=93","./app.js?v=93","./archive-format.js?v=93","./brainbot.js?v=93","./breeding-options.js?v=93","./breeding-planner.js?v=93","./breeding-summary.js?v=93","./cage-history.js?v=93","./cage-label.js?v=93","./cage-managers.js?v=93","./cage-movement.js?v=93","./cage-observations.js?v=93","./cage-sheet.js?v=93","./cage-start.js?v=93","./cage-summary-options.js?v=93","./cage-summary.js?v=93","./config.js?v=93","./cryo-sources.js?v=93","./cryopreservation-model.js?v=93","./cryopreservation.js?v=93","./data-store.js?v=93","./experiment-model.js?v=93","./experiment-source-timing.js?v=93","./experiment-sources.js?v=93","./experiment-timing.js?v=93","./experiments.js?v=93","./export-center.js?v=93","./family-explorer.js?v=93","./family-genotypes.js?v=93","./family-targets.js?v=93","./genetics.js?v=93","./genotype-catalog.js?v=93","./genotype-schema.js?v=93","./history-index.js?v=93","./husbandry.js?v=93","./iacuc-model.js?v=93","./iacuc-planning.js?v=93","./iacuc.js?v=93","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=93","./lac-fee-model.js?v=93","./lac-fee-occupancy.js?v=93","./lac-fees.js?v=93","./litter-summary.js?v=93","./local-backup.js?v=93","./locobox-export.js?v=93","./locobox-label.js?v=93","./locobox-model.js?v=93","./locobox.js?v=93","./manifest.webmanifest","./model.js?v=93","./mouse-registration.js?v=93","./mouse-review-view.js?v=93","./mouse-review.js?v=93","./mouse-summary.js?v=93","./overview-summary.js?v=93","./permissions.js?v=93","./room-order.js?v=93","./site-migration.js?v=93","./strain-management.js?v=93","./strain-registry.js?v=93","./styles.css?v=93","./user-acronyms.js?v=93","./user-management.js?v=93","./workbook-export.js?v=93"];
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
