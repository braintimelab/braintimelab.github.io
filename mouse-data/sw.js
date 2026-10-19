/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v158';
const SHELL = ["./","./access-activity.js?v=113","./access-logs.js?v=153","./account-acronym.js?v=100","./account-setup.js?v=100","./animal-sheet-export.js?v=146","./animal-sheet-import.js?v=143","./app.js?v=158","./archive-format.js?v=146","./brainbot-review-runner.js?v=146","./brainbot-review.js?v=146","./brainbot.js?v=112","./breeding-guidance.js?v=121","./breeding-options.js?v=100","./breeding-planner.js?v=146","./breeding-presets.js?v=146","./breeding-strategy.js?v=121","./breeding-summary.js?v=146","./cage-badges.js?v=132","./cage-entrainment.js?v=132","./cage-history.js?v=100","./cage-label.js?v=146","./cage-managers.js?v=100","./cage-movement.js?v=146","./cage-note-badges.js?v=103","./cage-observations.js?v=100","./cage-sheet.js?v=150","./cage-start.js?v=146","./cage-summary-options.js?v=100","./cage-summary.js?v=146","./cloud-bridge.js?v=150","./cloud-intents.js?v=137","./cloud-monitor.js?v=139","./cloud-provider.js?v=150","./cloud-status.js?v=149","./config.js?v=137","./cryo-sources.js?v=100","./cryopreservation-model.js?v=132","./cryopreservation.js?v=146","./data-store.js?v=158","./entrainment-history.js?v=132","./experiment-model.js?v=132","./experiment-sheet-import.js?v=126","./experiment-source-timing.js?v=100","./experiment-sources.js?v=100","./experiment-timing.js?v=100","./experiments.js?v=132","./export-center.js?v=154","./family-explorer.js?v=146","./family-genotypes.js?v=146","./family-targets.js?v=146","./genetics.js?v=100","./genotype-catalog.js?v=146","./genotype-schema.js?v=100","./guest-access.js?v=158","./history-index.js?v=100","./husbandry.js?v=146","./iacuc-model.js?v=132","./iacuc-planning.js?v=100","./iacuc.js?v=132","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=158","./lac-fee-model.js?v=146","./lac-fee-occupancy.js?v=146","./lac-fees.js?v=146","./litter-summary.js?v=100","./local-backup.js?v=100","./locobox-export.js?v=100","./locobox-label.js?v=146","./locobox-model.js?v=132","./locobox.js?v=132","./manifest.webmanifest","./model.js?v=146","./mouse-registration.js?v=146","./mouse-review-view.js?v=100","./mouse-review.js?v=100","./mouse-summary.js?v=146","./overview-summary.js?v=146","./permissions.js?v=100","./planner-layout.css?v=130","./presence.js?v=157","./room-order.js?v=100","./site-migration.js?v=100","./strain-cryo-links.js?v=118","./strain-management.css?v=115","./strain-management.js?v=146","./strain-reference-data.js?v=118","./strain-registry.js?v=146","./styles.css?v=142","./table-history.js?v=104","./user-acronyms.js?v=100","./user-management.js?v=158","./workbook-export.js?v=100"];
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
