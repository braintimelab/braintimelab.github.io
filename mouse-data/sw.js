/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v98';
const SHELL = ["./","./access-activity.js?v=98","./access-logs.js?v=98","./account-acronym.js?v=98","./account-setup.js?v=98","./animal-sheet-export.js?v=98","./animal-sheet-import.js?v=98","./app.js?v=98","./archive-format.js?v=98","./brainbot-review-runner.js?v=98","./brainbot-review.js?v=98","./brainbot.js?v=98","./breeding-options.js?v=98","./breeding-planner.js?v=98","./breeding-summary.js?v=98","./cage-entrainment.js?v=98","./cage-history.js?v=98","./cage-label.js?v=98","./cage-managers.js?v=98","./cage-movement.js?v=98","./cage-observations.js?v=98","./cage-sheet.js?v=98","./cage-start.js?v=98","./cage-summary-options.js?v=98","./cage-summary.js?v=98","./config.js?v=98","./cryo-sources.js?v=98","./cryopreservation-model.js?v=98","./cryopreservation.js?v=98","./data-store.js?v=98","./experiment-model.js?v=98","./experiment-source-timing.js?v=98","./experiment-sources.js?v=98","./experiment-timing.js?v=98","./experiments.js?v=98","./export-center.js?v=98","./family-explorer.js?v=98","./family-genotypes.js?v=98","./family-targets.js?v=98","./genetics.js?v=98","./genotype-catalog.js?v=98","./genotype-schema.js?v=98","./history-index.js?v=98","./husbandry.js?v=98","./iacuc-model.js?v=98","./iacuc-planning.js?v=98","./iacuc.js?v=98","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=98","./lac-fee-model.js?v=98","./lac-fee-occupancy.js?v=98","./lac-fees.js?v=98","./litter-summary.js?v=98","./local-backup.js?v=98","./locobox-export.js?v=98","./locobox-label.js?v=98","./locobox-model.js?v=98","./locobox.js?v=98","./manifest.webmanifest","./model.js?v=98","./mouse-registration.js?v=98","./mouse-review-view.js?v=98","./mouse-review.js?v=98","./mouse-summary.js?v=98","./overview-summary.js?v=98","./permissions.js?v=98","./room-order.js?v=98","./site-migration.js?v=98","./strain-management.js?v=98","./strain-registry.js?v=98","./styles.css?v=98","./user-acronyms.js?v=98","./user-management.js?v=98","./workbook-export.js?v=98"];
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
