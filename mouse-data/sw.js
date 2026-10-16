/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v94';
const SHELL = ["./","./access-activity.js?v=94","./access-logs.js?v=94","./account-acronym.js?v=94","./account-setup.js?v=94","./animal-sheet-export.js?v=94","./animal-sheet-import.js?v=94","./app.js?v=94","./archive-format.js?v=94","./brainbot.js?v=94","./breeding-options.js?v=94","./breeding-planner.js?v=94","./breeding-summary.js?v=94","./cage-entrainment.js?v=94","./cage-history.js?v=94","./cage-label.js?v=94","./cage-managers.js?v=94","./cage-movement.js?v=94","./cage-observations.js?v=94","./cage-sheet.js?v=94","./cage-start.js?v=94","./cage-summary-options.js?v=94","./cage-summary.js?v=94","./config.js?v=94","./cryo-sources.js?v=94","./cryopreservation-model.js?v=94","./cryopreservation.js?v=94","./data-store.js?v=94","./experiment-model.js?v=94","./experiment-source-timing.js?v=94","./experiment-sources.js?v=94","./experiment-timing.js?v=94","./experiments.js?v=94","./export-center.js?v=94","./family-explorer.js?v=94","./family-genotypes.js?v=94","./family-targets.js?v=94","./genetics.js?v=94","./genotype-catalog.js?v=94","./genotype-schema.js?v=94","./history-index.js?v=94","./husbandry.js?v=94","./iacuc-model.js?v=94","./iacuc-planning.js?v=94","./iacuc.js?v=94","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=94","./lac-fee-model.js?v=94","./lac-fee-occupancy.js?v=94","./lac-fees.js?v=94","./litter-summary.js?v=94","./local-backup.js?v=94","./locobox-export.js?v=94","./locobox-label.js?v=94","./locobox-model.js?v=94","./locobox.js?v=94","./manifest.webmanifest","./model.js?v=94","./mouse-registration.js?v=94","./mouse-review-view.js?v=94","./mouse-review.js?v=94","./mouse-summary.js?v=94","./overview-summary.js?v=94","./permissions.js?v=94","./room-order.js?v=94","./site-migration.js?v=94","./strain-management.js?v=94","./strain-registry.js?v=94","./styles.css?v=94","./user-acronyms.js?v=94","./user-management.js?v=94","./workbook-export.js?v=94"];
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
