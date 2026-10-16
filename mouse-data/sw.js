/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v95';
const SHELL = ["./","./access-activity.js?v=95","./access-logs.js?v=95","./account-acronym.js?v=95","./account-setup.js?v=95","./animal-sheet-export.js?v=95","./animal-sheet-import.js?v=95","./app.js?v=95","./archive-format.js?v=95","./brainbot.js?v=95","./breeding-options.js?v=95","./breeding-planner.js?v=95","./breeding-summary.js?v=95","./cage-entrainment.js?v=95","./cage-history.js?v=95","./cage-label.js?v=95","./cage-managers.js?v=95","./cage-movement.js?v=95","./cage-observations.js?v=95","./cage-sheet.js?v=95","./cage-start.js?v=95","./cage-summary-options.js?v=95","./cage-summary.js?v=95","./config.js?v=95","./cryo-sources.js?v=95","./cryopreservation-model.js?v=95","./cryopreservation.js?v=95","./data-store.js?v=95","./experiment-model.js?v=95","./experiment-source-timing.js?v=95","./experiment-sources.js?v=95","./experiment-timing.js?v=95","./experiments.js?v=95","./export-center.js?v=95","./family-explorer.js?v=95","./family-genotypes.js?v=95","./family-targets.js?v=95","./genetics.js?v=95","./genotype-catalog.js?v=95","./genotype-schema.js?v=95","./history-index.js?v=95","./husbandry.js?v=95","./iacuc-model.js?v=95","./iacuc-planning.js?v=95","./iacuc.js?v=95","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=95","./lac-fee-model.js?v=95","./lac-fee-occupancy.js?v=95","./lac-fees.js?v=95","./litter-summary.js?v=95","./local-backup.js?v=95","./locobox-export.js?v=95","./locobox-label.js?v=95","./locobox-model.js?v=95","./locobox.js?v=95","./manifest.webmanifest","./model.js?v=95","./mouse-registration.js?v=95","./mouse-review-view.js?v=95","./mouse-review.js?v=95","./mouse-summary.js?v=95","./overview-summary.js?v=95","./permissions.js?v=95","./room-order.js?v=95","./site-migration.js?v=95","./strain-management.js?v=95","./strain-registry.js?v=95","./styles.css?v=95","./user-acronyms.js?v=95","./user-management.js?v=95","./workbook-export.js?v=95"];
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
