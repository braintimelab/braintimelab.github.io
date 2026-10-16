/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v96';
const SHELL = ["./","./access-activity.js?v=96","./access-logs.js?v=96","./account-acronym.js?v=96","./account-setup.js?v=96","./animal-sheet-export.js?v=96","./animal-sheet-import.js?v=96","./app.js?v=96","./archive-format.js?v=96","./brainbot-review-runner.js?v=96","./brainbot-review.js?v=96","./brainbot.js?v=96","./breeding-options.js?v=96","./breeding-planner.js?v=96","./breeding-summary.js?v=96","./cage-entrainment.js?v=96","./cage-history.js?v=96","./cage-label.js?v=96","./cage-managers.js?v=96","./cage-movement.js?v=96","./cage-observations.js?v=96","./cage-sheet.js?v=96","./cage-start.js?v=96","./cage-summary-options.js?v=96","./cage-summary.js?v=96","./config.js?v=96","./cryo-sources.js?v=96","./cryopreservation-model.js?v=96","./cryopreservation.js?v=96","./data-store.js?v=96","./experiment-model.js?v=96","./experiment-source-timing.js?v=96","./experiment-sources.js?v=96","./experiment-timing.js?v=96","./experiments.js?v=96","./export-center.js?v=96","./family-explorer.js?v=96","./family-genotypes.js?v=96","./family-targets.js?v=96","./genetics.js?v=96","./genotype-catalog.js?v=96","./genotype-schema.js?v=96","./history-index.js?v=96","./husbandry.js?v=96","./iacuc-model.js?v=96","./iacuc-planning.js?v=96","./iacuc.js?v=96","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=96","./lac-fee-model.js?v=96","./lac-fee-occupancy.js?v=96","./lac-fees.js?v=96","./litter-summary.js?v=96","./local-backup.js?v=96","./locobox-export.js?v=96","./locobox-label.js?v=96","./locobox-model.js?v=96","./locobox.js?v=96","./manifest.webmanifest","./model.js?v=96","./mouse-registration.js?v=96","./mouse-review-view.js?v=96","./mouse-review.js?v=96","./mouse-summary.js?v=96","./overview-summary.js?v=96","./permissions.js?v=96","./room-order.js?v=96","./site-migration.js?v=96","./strain-management.js?v=96","./strain-registry.js?v=96","./styles.css?v=96","./user-acronyms.js?v=96","./user-management.js?v=96","./workbook-export.js?v=96"];
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
