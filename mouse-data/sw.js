/* Cache only the current public app shell. Private APIs and imported data never enter this cache. */
// Regenerate after version changes: node tests/sw-shell.test.mjs --update-shell
const CACHE = 'colony-shell-v189';
const SHELL = ["./","./access-activity.js?v=113","./access-logs.js?v=171","./account-acronym.js?v=100","./account-setup.js?v=162","./animal-sheet-current-observation.js?v=183","./animal-sheet-export.js?v=188","./animal-sheet-import.js?v=173","./app-access.js?v=175","./app.js?v=188","./archive-format.js?v=174","./brainbot-review-runner.js?v=174","./brainbot-review.js?v=174","./brainbot.js?v=112","./breeding-guidance.js?v=121","./breeding-options.js?v=100","./breeding-planner.js?v=188","./breeding-presets.js?v=146","./breeding-strategy.js?v=121","./breeding-summary.js?v=146","./cage-badges.js?v=132","./cage-entrainment.js?v=132","./cage-history.js?v=100","./cage-label.js?v=188","./cage-managers.js?v=100","./cage-movement.js?v=174","./cage-note-badges.js?v=103","./cage-observations.js?v=100","./cage-sheet.js?v=188","./cage-start.js?v=174","./cage-summary-options.js?v=100","./cage-summary.js?v=146","./cloud-bridge.js?v=183","./cloud-intents.js?v=137","./cloud-monitor.js?v=167","./cloud-provider.js?v=183","./cloud-recovery.js?v=165","./cloud-status.js?v=149","./config.js?v=137","./cryo-register.js?v=178","./cryo-sources.js?v=178","./cryopreservation-model.js?v=132","./cryopreservation.js?v=189","./current-record-scope.js?v=184","./data-store.js?v=188","./entrainment-history.js?v=132","./experiment-model.js?v=132","./experiment-sheet-import.js?v=126","./experiment-source-timing.js?v=100","./experiment-sources.js?v=100","./experiment-timing.js?v=100","./experiments.js?v=189","./export-center.js?v=188","./family-explorer.js?v=188","./family-genotypes.js?v=188","./family-targets.js?v=146","./genetics.js?v=100","./genotype-catalog.js?v=146","./genotype-schema.js?v=100","./guest-access.js?v=175","./history-index.js?v=100","./husbandry.js?v=188","./iacuc-model.js?v=132","./iacuc-planning.js?v=100","./iacuc.js?v=189","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lab-members.js?v=175","./lac-fee-model.js?v=174","./lac-fee-occupancy.js?v=174","./lac-fees.js?v=174","./litter-summary.js?v=100","./local-backup.js?v=100","./locobox-export.js?v=100","./locobox-label.js?v=188","./locobox-model.js?v=132","./locobox.js?v=132","./managed-view.js?v=184","./manifest.webmanifest","./model.js?v=188","./mouse-registration-batch.js?v=188","./mouse-registration-import.js?v=188","./mouse-registration.js?v=188","./mouse-review-view.js?v=184","./mouse-review.js?v=184","./mouse-sid.js?v=188","./mouse-summary.js?v=146","./overview-summary.js?v=146","./parentage-evidence.js?v=188","./parentage-review.js?v=187","./permissions.js?v=100","./planner-layout.css?v=130","./presence.js?v=171","./room-order.js?v=100","./site-migration.js?v=100","./source-import-validation.js?v=183","./source-reconciliation-view.js?v=187","./source-reconciliation.js?v=187","./source-tag-review.js?v=183","./startup-read.js?v=174","./strain-cryo-links.js?v=178","./strain-management.css?v=115","./strain-management.js?v=178","./strain-reference-data.js?v=118","./strain-registry.js?v=146","./styles.css?v=186","./table-history.js?v=104","./user-acronyms.js?v=100","./user-management.js?v=179","./workbook-export.js?v=100"];
const PRECACHE = ["./","./access-activity.js?v=113","./animal-sheet-current-observation.js?v=183","./animal-sheet-export.js?v=188","./animal-sheet-import.js?v=173","./app-access.js?v=175","./app.js?v=188","./archive-format.js?v=174","./breeding-options.js?v=100","./breeding-summary.js?v=146","./cage-badges.js?v=132","./cage-entrainment.js?v=132","./cage-history.js?v=100","./cage-managers.js?v=100","./cage-movement.js?v=174","./cage-note-badges.js?v=103","./cage-observations.js?v=100","./cage-sheet.js?v=188","./cage-start.js?v=174","./cage-summary-options.js?v=100","./cage-summary.js?v=146","./cloud-bridge.js?v=183","./cloud-intents.js?v=137","./cloud-monitor.js?v=167","./cloud-provider.js?v=183","./cloud-recovery.js?v=165","./cloud-status.js?v=149","./config.js?v=137","./cryopreservation-model.js?v=132","./current-record-scope.js?v=184","./data-store.js?v=188","./entrainment-history.js?v=132","./experiment-model.js?v=132","./experiment-sheet-import.js?v=126","./experiment-timing.js?v=100","./family-explorer.js?v=188","./family-genotypes.js?v=188","./family-targets.js?v=146","./genetics.js?v=100","./genotype-catalog.js?v=146","./genotype-schema.js?v=100","./guest-access.js?v=175","./history-index.js?v=100","./husbandry.js?v=188","./iacuc-model.js?v=132","./icons/apple-touch-icon.png","./icons/braintime-mark.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./lac-fee-model.js?v=174","./lac-fee-occupancy.js?v=174","./litter-summary.js?v=100","./local-backup.js?v=100","./locobox-export.js?v=100","./locobox-model.js?v=132","./managed-view.js?v=184","./manifest.webmanifest","./model.js?v=188","./mouse-registration-batch.js?v=188","./mouse-registration-import.js?v=188","./mouse-registration.js?v=188","./mouse-review.js?v=184","./mouse-sid.js?v=188","./mouse-summary.js?v=146","./overview-summary.js?v=146","./parentage-evidence.js?v=188","./parentage-review.js?v=187","./permissions.js?v=100","./presence.js?v=171","./room-order.js?v=100","./site-migration.js?v=100","./source-import-validation.js?v=183","./source-reconciliation-view.js?v=187","./source-reconciliation.js?v=187","./source-tag-review.js?v=183","./startup-read.js?v=174","./strain-reference-data.js?v=118","./strain-registry.js?v=146","./styles.css?v=186","./table-history.js?v=104","./user-acronyms.js?v=100","./workbook-export.js?v=100"];
// Existing lazy imports keep one module identity. Changed bytes at these
// exact public URLs must replace prior releases rather than carry forward.
const REFRESH = new Set(["./data-store.js?v=184","./current-record-scope.js?v=184","./managed-view.js?v=184","./mouse-review.js?v=184","./mouse-review-view.js?v=184","./husbandry.js?v=184","./animal-sheet-export.js?v=184","./export-center.js?v=184"]);
const allowed = new Set(SHELL.map(path => new URL(path,self.registration.scope).href));
// Carry forward only immutable, exact public release URLs. Optional sections
// already saved locally stay available without fetching them during opening.
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE),required=new Set(PRECACHE),names=await caches.keys();
  const previous=await Promise.all(names.filter(name=>name.startsWith('colony-shell-')&&name!==CACHE).map(name=>caches.open(name)));
  await Promise.all(SHELL.map(async path=>{
    const url=new URL(path,self.registration.scope);let response=null;
    if(url.searchParams.has('v')&&!REFRESH.has(path)){
      for(const saved of [cache,...previous]){
        const found=await saved.match(url.href);
        if(found?.ok&&found.type==='basic'){response=found;break;}
      }
    }
    if(!response&&(required.has(path)||REFRESH.has(path)))response=await fetch(url.href,{cache:'no-store'});
    if(!response)return;
    if(!response.ok||response.type!=='basic')throw new Error('Public app shell could not be verified.');
    await cache.put(url.href,response);
  }));
  await self.skipWaiting();
})()));
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
