// Public navigation only. Never read, copy or store a member session here.
const MAIN = 'https://braintimemain.tail933238.ts.net:10000';
const RECOVERY = 'https://braintimedisk.tail933238.ts.net:10000';
const DEPLOYMENT = '61af3893-f1cb-417c-8c7c-2b7cfb0a89fd';
const FORMAT = 'braintime-public-service-status-v2';
const MAX_AGE = 60_000;
const LIMIT = 8192;
const PATHS = Object.freeze({workspace:'/workspace/',boards:'/', 'mouse-data':'/mouse-data/',reagents:'/reagents/',primers:'/primers/',calculator:'/calculator/'});
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === 'string' && value.length <= 40 ? Date.parse(value) : NaN;

function commonReady(status, now) {
  const timestamp = date(status?.observedAt);
  return status?.format === FORMAT && status.deploymentId === DEPLOYMENT &&
    status.authReady === true && status.dataReady === true &&
    Number.isFinite(timestamp) && Math.abs(timestamp - now) <= MAX_AGE &&
    typeof status.generation === 'string' && status.generation.length > 7 && status.generation.length <= 128 &&
    digest(status.captureSha256) && ['identity','projection','service'].every(key => digest(status.acceptances?.[key]));
}

export function mainReady(status, now = Date.now()) {
  return commonReady(status, now) && status.cloudId === 'cloud1' && status.mode === 'primary' &&
    status.service === 'ready' && status.writable === true;
}

// The moment (epoch ms) a status that passes mainReady now stops passing it under the clock rule above.
export function mainValidUntil(status) {
  return date(status?.observedAt) + MAX_AGE;
}

export function recoveryReady(status, now = Date.now()) {
  const captured = date(status?.dataCapturedAt), completed = date(status?.backupCompletedAt), valid = date(status?.policyValidUntil);
  return commonReady(status, now) && status.cloudId === 'cloud2' && status.mode === 'full-backup' &&
    ['ready','degraded'].includes(status.service) && status.writable === false &&
    status.coverage === 'full' && status.integrityVerified === true && status.recoveryReady === true &&
    [captured,completed,valid].every(Number.isFinite) && captured <= completed &&
    completed <= now + MAX_AGE && valid > now;
}

function appHash(value = '') {
  // Preserve ordinary menu links, never OAuth tokens, setup codes or arbitrary URLs.
  return /^#[a-z][a-z0-9/_-]{0,127}$/i.test(value) && !/token|password|code|setup|recovery/i.test(value) ? value : '';
}

export function destinations(app, hash = '') {
  const path = Object.hasOwn(PATHS, app) ? PATHS[app] : PATHS.workspace;
  return {main:MAIN+path+appHash(hash), recovery:RECOVERY+path+appHash(hash), limited:'/internal/limited/'};
}

async function readBoundedJson(response) {
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
      Number(response.headers.get('content-length') || 0) > LIMIT || !response.body) return null;
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true});
  let length = 0, value = '';
  try {
    for (;;) {
      const {done,value:chunk} = await reader.read();
      if (done) break;
      length += chunk.byteLength;
      if (length > LIMIT) return null;
      value += decoder.decode(chunk,{stream:true});
    }
    return JSON.parse(value + decoder.decode());
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

async function probe(origin, {fetchImpl,timeout,signal,now,validate}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort',abort,{once:true});
  let timer;
  try {
    return await Promise.race([
      (async()=>{
        const response = await fetchImpl(origin+'/workspace/status',{
          credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,
        });
        const status = await readBoundedJson(response);
        return validate(status,now()) ? status : null;
      })(),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},timeout);}),
      new Promise(resolve=>signal.addEventListener('abort',()=>resolve(null),{once:true})),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort',abort); }
}

// The one Main check, shared with public links (assets/entry-links.mjs): the verified status, or null.
export function probeMain({fetchImpl,timeout=4000,signal=new AbortController().signal,now=Date.now}) {
  return probe(MAIN,{fetchImpl,timeout,signal,now,validate:mainReady});
}

export async function openApp({doc,location,fetchImpl,timeout=4000,now=Date.now}) {
  const nav=doc.querySelector('[data-workspace-servers]'), status=doc.getElementById('workspace-entry-status');
  if (!nav || !status) return;
  const app=Object.hasOwn(PATHS,doc.body?.dataset.appEntry) ? doc.body.dataset.appEntry : 'workspace';
  const links=destinations(app,location.hash);
  for (const [server,selector] of [['main','[data-main-entry]'],['recovery','[data-recovery-entry]'],['limited','[data-limited-entry]']]) {
    const link=nav.querySelector(selector); if(link) link.href=links[server];
  }
  const params=new URLSearchParams(location.search);
  if (params.has('choose')) {status.textContent='Choose a server. Recovery is a read-only backup.';return;}
  const requested=params.get('server');
  if (['main','recovery','limited'].includes(requested)) {location.replace(links[requested]);return;}

  const controller=new AbortController();
  const manual=()=>{controller.abort();status.textContent='Choose a server. Recovery is a read-only backup.';};
  nav.addEventListener('click',manual,{once:true}); nav.addEventListener('focusin',manual,{once:true});
  status.textContent='Opening Main. Recovery is a read-only backup.';
  // Probe in parallel, prefer Main, and bound the entire decision to four seconds.
  const main=probeMain({fetchImpl,timeout,signal:controller.signal,now});
  const recovery=probe(RECOVERY,{fetchImpl,timeout,signal:controller.signal,now,validate:recoveryReady});
  try {
    const primary=await main;
    if(controller.signal.aborted)return;
    if(primary){location.replace(links.main);return;}
    status.textContent='Main is unavailable. Checking the read-only Recovery backup…';
    const backup=await recovery;
    if(controller.signal.aborted)return;
    if(backup){location.replace(links.recovery);return;}
    status.textContent='Main and Recovery are unavailable. Opening Limited Workspace…';
    location.replace(links.limited);
  } finally {
    controller.abort();nav.removeEventListener('click',manual);nav.removeEventListener('focusin',manual);
  }
}

// Compatibility for bookmarks to the earlier /internal/ launcher.
export const openMain = openApp;
// Only entry pages route; public pages import this module for its checks alone.
if(typeof document!=='undefined'&&document.body?.dataset.appEntry)void openApp({doc:document,location:window.location,fetchImpl:window.fetch.bind(window)});
