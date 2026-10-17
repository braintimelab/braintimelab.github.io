/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v99';
const SHELL = ["./","./access-activity.js?v=99","./access-logs.js?v=99","./account-acronym.js?v=99","./account-setup.js?v=99","./animal-sheet-export.js?v=99","./animal-sheet-import.js?v=99","./app.js?v=99","./archive-format.js?v=99","./brainbot-review-runner.js?v=99","./brainbot-review.js?v=99","./brainbot.js?v=99","./breeding-options.js?v=99","./breeding-planner.js?v=99","./breeding-summary.js?v=99","./cage-entrainment.js?v=99","./cage-history.js?v=99","./cage-label.js?v=99","./cage-managers.js?v=99","./cage-movement.js?v=99","./cage-observations.js?v=99","./cage-sheet.js?v=99","./cage-start.js?v=99","./cage-summary-options.js?v=99","./cage-summary.js?v=99","./config.js?v=99","./cryo-sources.js?v=99","./cryopreservation-model.js?v=99","./cryopreservation.js?v=99","./data-store.js?v=99","./experiment-model.js?v=99","./experiment-source-timing.js?v=99","./experiment-sources.js?v=99","./experiment-timing.js?v=99","./experiments.js?v=99","./export-center.js?v=99","./family-explorer.js?v=99","./family-genotypes.js?v=99","./family-targets.js?v=99","./genetics.js?v=99","./genotype-catalog.js?v=99","./genotype-schema.js?v=99","./history-index.js?v=99","./husbandry.js?v=99","./iacuc-model.js?v=99","./iacuc-planning.js?v=99","./iacuc.js?v=99","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=99","./lac-fee-model.js?v=99","./lac-fee-occupancy.js?v=99","./lac-fees.js?v=99","./litter-summary.js?v=99","./local-backup.js?v=99","./locobox-export.js?v=99","./locobox-label.js?v=99","./locobox-model.js?v=99","./locobox.js?v=99","./manifest.webmanifest","./model.js?v=99","./mouse-registration.js?v=99","./mouse-review-view.js?v=99","./mouse-review.js?v=99","./mouse-summary.js?v=99","./overview-summary.js?v=99","./permissions.js?v=99","./room-order.js?v=99","./site-migration.js?v=99","./strain-management.js?v=99","./strain-registry.js?v=99","./styles.css?v=99","./user-acronyms.js?v=99","./user-management.js?v=99","./workbook-export.js?v=99"];
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
