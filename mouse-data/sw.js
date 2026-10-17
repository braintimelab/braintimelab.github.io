/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v97';
const SHELL = ["./","./access-activity.js?v=97","./access-logs.js?v=97","./account-acronym.js?v=97","./account-setup.js?v=97","./animal-sheet-export.js?v=97","./animal-sheet-import.js?v=97","./app.js?v=97","./archive-format.js?v=97","./brainbot-review-runner.js?v=97","./brainbot-review.js?v=97","./brainbot.js?v=97","./breeding-options.js?v=97","./breeding-planner.js?v=97","./breeding-summary.js?v=97","./cage-entrainment.js?v=97","./cage-history.js?v=97","./cage-label.js?v=97","./cage-managers.js?v=97","./cage-movement.js?v=97","./cage-observations.js?v=97","./cage-sheet.js?v=97","./cage-start.js?v=97","./cage-summary-options.js?v=97","./cage-summary.js?v=97","./config.js?v=97","./cryo-sources.js?v=97","./cryopreservation-model.js?v=97","./cryopreservation.js?v=97","./data-store.js?v=97","./experiment-model.js?v=97","./experiment-source-timing.js?v=97","./experiment-sources.js?v=97","./experiment-timing.js?v=97","./experiments.js?v=97","./export-center.js?v=97","./family-explorer.js?v=97","./family-genotypes.js?v=97","./family-targets.js?v=97","./genetics.js?v=97","./genotype-catalog.js?v=97","./genotype-schema.js?v=97","./history-index.js?v=97","./husbandry.js?v=97","./iacuc-model.js?v=97","./iacuc-planning.js?v=97","./iacuc.js?v=97","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=97","./lac-fee-model.js?v=97","./lac-fee-occupancy.js?v=97","./lac-fees.js?v=97","./litter-summary.js?v=97","./local-backup.js?v=97","./locobox-export.js?v=97","./locobox-label.js?v=97","./locobox-model.js?v=97","./locobox.js?v=97","./manifest.webmanifest","./model.js?v=97","./mouse-registration.js?v=97","./mouse-review-view.js?v=97","./mouse-review.js?v=97","./mouse-summary.js?v=97","./overview-summary.js?v=97","./permissions.js?v=97","./room-order.js?v=97","./site-migration.js?v=97","./strain-management.js?v=97","./strain-registry.js?v=97","./styles.css?v=97","./user-acronyms.js?v=97","./user-management.js?v=97","./workbook-export.js?v=97"];
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
