/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v92';
const SHELL = ["./","./access-activity.js?v=92","./access-logs.js?v=92","./account-acronym.js?v=92","./account-setup.js?v=92","./animal-sheet-export.js?v=92","./animal-sheet-import.js?v=92","./app.js?v=92","./archive-format.js?v=92","./brainbot.js?v=92","./breeding-options.js?v=92","./breeding-planner.js?v=92","./breeding-summary.js?v=92","./cage-history.js?v=92","./cage-label.js?v=92","./cage-managers.js?v=92","./cage-movement.js?v=92","./cage-observations.js?v=92","./cage-sheet.js?v=92","./cage-start.js?v=92","./cage-summary-options.js?v=92","./cage-summary.js?v=92","./config.js?v=92","./cryo-sources.js?v=92","./cryopreservation-model.js?v=92","./cryopreservation.js?v=92","./data-store.js?v=92","./experiment-model.js?v=92","./experiment-source-timing.js?v=92","./experiment-sources.js?v=92","./experiment-timing.js?v=92","./experiments.js?v=92","./export-center.js?v=92","./family-explorer.js?v=92","./family-genotypes.js?v=92","./family-targets.js?v=92","./genetics.js?v=92","./genotype-catalog.js?v=92","./genotype-schema.js?v=92","./history-index.js?v=92","./husbandry.js?v=92","./iacuc-model.js?v=92","./iacuc-planning.js?v=92","./iacuc.js?v=92","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=92","./lac-fee-model.js?v=92","./lac-fee-occupancy.js?v=92","./lac-fees.js?v=92","./litter-summary.js?v=92","./local-backup.js?v=92","./locobox-export.js?v=92","./locobox-label.js?v=92","./locobox-model.js?v=92","./locobox.js?v=92","./manifest.webmanifest","./model.js?v=92","./mouse-registration.js?v=92","./mouse-review-view.js?v=92","./mouse-review.js?v=92","./mouse-summary.js?v=92","./overview-summary.js?v=92","./permissions.js?v=92","./room-order.js?v=92","./site-migration.js?v=92","./strain-management.js?v=92","./strain-registry.js?v=92","./styles.css?v=92","./user-acronyms.js?v=92","./user-management.js?v=92","./workbook-export.js?v=92"];
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
