/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v89';
const SHELL = ["./","./access-activity.js?v=89","./access-logs.js?v=89","./account-acronym.js?v=89","./account-setup.js?v=89","./animal-sheet-export.js?v=89","./animal-sheet-import.js?v=89","./app.js?v=89","./archive-format.js?v=89","./brainbot.js?v=89","./breeding-options.js?v=89","./breeding-planner.js?v=89","./breeding-summary.js?v=89","./cage-history.js?v=89","./cage-label.js?v=89","./cage-managers.js?v=89","./cage-movement.js?v=89","./cage-observations.js?v=89","./cage-sheet.js?v=89","./cage-start.js?v=89","./cage-summary-options.js?v=89","./cage-summary.js?v=89","./config.js?v=89","./cryo-sources.js?v=89","./cryopreservation-model.js?v=89","./cryopreservation.js?v=89","./data-store.js?v=89","./experiment-model.js?v=89","./experiment-source-timing.js?v=89","./experiment-sources.js?v=89","./experiment-timing.js?v=89","./experiments.js?v=89","./export-center.js?v=89","./family-explorer.js?v=89","./family-genotypes.js?v=89","./family-targets.js?v=89","./genetics.js?v=89","./genotype-catalog.js?v=89","./genotype-schema.js?v=89","./history-index.js?v=89","./husbandry.js?v=89","./iacuc-model.js?v=89","./iacuc-planning.js?v=89","./iacuc.js?v=89","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=89","./lac-fee-model.js?v=89","./lac-fee-occupancy.js?v=89","./lac-fees.js?v=89","./litter-summary.js?v=89","./local-backup.js?v=89","./locobox-export.js?v=89","./locobox-label.js?v=89","./locobox-model.js?v=89","./locobox.js?v=89","./manifest.webmanifest","./model.js?v=89","./mouse-registration.js?v=89","./mouse-review-view.js?v=89","./mouse-review.js?v=89","./mouse-summary.js?v=89","./overview-summary.js?v=89","./permissions.js?v=89","./room-order.js?v=89","./site-migration.js?v=89","./strain-management.js?v=89","./strain-registry.js?v=89","./styles.css?v=89","./user-acronyms.js?v=89","./user-management.js?v=89","./workbook-export.js?v=89"];
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
