/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v90';
const SHELL = ["./","./access-activity.js?v=90","./access-logs.js?v=90","./account-acronym.js?v=90","./account-setup.js?v=90","./animal-sheet-export.js?v=90","./animal-sheet-import.js?v=90","./app.js?v=90","./archive-format.js?v=90","./brainbot.js?v=90","./breeding-options.js?v=90","./breeding-planner.js?v=90","./breeding-summary.js?v=90","./cage-history.js?v=90","./cage-label.js?v=90","./cage-managers.js?v=90","./cage-movement.js?v=90","./cage-observations.js?v=90","./cage-sheet.js?v=90","./cage-start.js?v=90","./cage-summary-options.js?v=90","./cage-summary.js?v=90","./config.js?v=90","./cryo-sources.js?v=90","./cryopreservation-model.js?v=90","./cryopreservation.js?v=90","./data-store.js?v=90","./experiment-model.js?v=90","./experiment-source-timing.js?v=90","./experiment-sources.js?v=90","./experiment-timing.js?v=90","./experiments.js?v=90","./export-center.js?v=90","./family-explorer.js?v=90","./family-genotypes.js?v=90","./family-targets.js?v=90","./genetics.js?v=90","./genotype-catalog.js?v=90","./genotype-schema.js?v=90","./history-index.js?v=90","./husbandry.js?v=90","./iacuc-model.js?v=90","./iacuc-planning.js?v=90","./iacuc.js?v=90","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=90","./lac-fee-model.js?v=90","./lac-fee-occupancy.js?v=90","./lac-fees.js?v=90","./litter-summary.js?v=90","./local-backup.js?v=90","./locobox-export.js?v=90","./locobox-label.js?v=90","./locobox-model.js?v=90","./locobox.js?v=90","./manifest.webmanifest","./model.js?v=90","./mouse-registration.js?v=90","./mouse-review-view.js?v=90","./mouse-review.js?v=90","./mouse-summary.js?v=90","./overview-summary.js?v=90","./permissions.js?v=90","./room-order.js?v=90","./site-migration.js?v=90","./strain-management.js?v=90","./strain-registry.js?v=90","./styles.css?v=90","./user-acronyms.js?v=90","./user-management.js?v=90","./workbook-export.js?v=90"];
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
