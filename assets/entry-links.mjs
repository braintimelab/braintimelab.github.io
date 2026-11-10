// Public navigation only. Never read, copy or store a member session here.
// While Main was verified moments ago, links to the app entry pages go straight to Main.
// Otherwise they keep their entry page, which still decides Main -> Recovery -> Limited.
const MAIN = 'https://braintimemain.tail933238.ts.net:10000'; // app-entry.mjs's Main (tested); warmed before it loads
const APPS = Object.freeze({'/workspace/':'workspace','/boards/':'boards','/mouse-data/':'mouse-data','/reagents/':'reagents',
  '/primers/':'primers','/calculator/':'calculator','/internal/':'workspace', // /internal/ routes exactly like /workspace/
  '/mouse/':'mouse-data','/animals/':'mouse-data'}); // the short names route exactly like /mouse-data/ (same page)
const NAMES = Object.freeze({workspace:'Workspace',boards:'Boards','mouse-data':'Mouse Data',reagents:'Reagents',primers:'Primers',calculator:'Calculator'});
export const FRESH = 45_000; // a verified Main is used for at most 45 s, and never past its status' own 60 s window
export const PATIENCE = 800; // a plain click waits for the shared probe only while it is younger than this

function entryOf(link, base, origin) {
  if (link.hasAttribute('download')) return null;
  let url;
  try { url = new URL(link.getAttribute('href'), base); } catch { return null; }
  const path = url.pathname.replace(/\/index\.html$/, '/');
  // A query (?server=, ?choose) stays with the entry page, which honours it.
  if (url.origin !== origin || url.search || !Object.hasOwn(APPS, path)) return null;
  return {link, app:APPS[path], hash:url.hash, href:link.getAttribute('href'), url:url.href};
}

// Chrome asks before a public page may reach a tailnet (local network) address. Until this site has been allowed that,
// the entry page asks, in context; a hover never does. Browsers without such a permission go ahead.
async function allowed(permissions) {
  for (const name of ['local-network', 'local-network-access']) {
    try { return (await permissions.query({name})).state === 'granted'; } catch {}
  }
  return true;
}

export function enhanceEntryLinks({doc, win, location, fetchImpl, permissions, load = () => import('./app-entry.mjs?v=3'),
  clock = () => performance.now(), now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, timeout = 4000}) {
  const items = [...doc.querySelectorAll('a[href]')].map(link => entryOf(link, doc.baseURI, location.origin)).filter(Boolean);
  if (!items.length) return 0;
  let entry = null, probe = null, result = null, expiry = 0, waiting = null, rest = 0, hints = [], status = null, entered = null;

  // The last probe result while it may be used: verified Main is re-checked with the same rules at each use.
  function current() {
    if (result && !(clock() - result.at <= FRESH && (!result.status || entry.mainReady(result.status, now())))) {
      clearTimer(expiry); result = null;
    }
    return result;
  }
  function apply() {
    const verified = Boolean(current()?.status);
    for (const item of items) {
      const href = verified ? entry.destinations(item.app, item.hash).main : item.href;
      if (item.link.getAttribute('href') !== href) item.link.setAttribute('href', href);
    }
  }
  function preconnect() {
    for (const hint of hints) hint.remove();
    // Anonymous for the credential-less probe, credentialed for the navigation that follows.
    hints = [true, false].map(anonymous => {
      const hint = doc.createElement('link');
      hint.rel = 'preconnect'; hint.href = MAIN;
      if (anonymous) hint.crossOrigin = 'anonymous';
      doc.head.append(hint);
      return hint;
    });
  }
  // One shared probe per page; its result (verified or not) stands until it expires.
  function warm() {
    if (probe || current()) return;
    const controller = new AbortController(), at = clock();
    probe = {controller, at};
    probe.done = (async () => {
      let verified = null, until = Infinity;
      try {
        if (await allowed(permissions) && !controller.signal.aborted) {
          preconnect();
          entry ??= await load();
          if (!controller.signal.aborted) verified = await entry.probeMain({fetchImpl, timeout, signal:controller.signal, now});
          if (verified) until = entry.mainValidUntil(verified);
        }
      } catch { verified = null; }
      if (probe?.controller !== controller) return;
      probe = null; result = {at, status:verified};
      clearTimer(expiry); // after FRESH, or once the status itself stops qualifying if that is sooner
      expiry = setTimer(() => { result = null; apply(); }, Math.max(0, Math.min(at + FRESH - clock(), until - now())) || 0);
      apply();
    })();
  }
  function region() {
    if (status) return;
    // Present (and empty) from the first intent on, so assistive technology announces what a click writes into it.
    status = doc.createElement('div');
    status.className = 'entry-link-status'; status.setAttribute('role', 'status');
    doc.body.append(status);
  }
  function idle() {
    for (const item of items) item.link.removeAttribute('aria-busy');
    if (status) status.textContent = '';
  }
  function busy(item) {
    clearTimer(rest); idle();
    item.link.setAttribute('aria-busy', 'true');
    status.textContent = `Opening ${NAMES[item.app]}…`;
  }
  function intent() { region(); apply(); warm(); }
  // A hover counts once the pointer itself moves over the link: a link scrolled under a resting cursor is not intent.
  function hover(event) {
    const spot = `${event.screenX},${event.screenY}`;
    if (event.type === 'pointerenter') entered = spot;
    else if (entered !== null && (event.movementX || event.movementY || spot !== entered)) { entered = null; intent(); }
  }
  function click(event) {
    const item = items.find(candidate => candidate.link === event.currentTarget);
    region(); apply();
    // Modifier, middle and new-tab clicks keep their native behaviour; the href already says where they go.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        (item.link.target && item.link.target !== '_self')) return;
    warm(); // a click is intent too, e.g. from assistive technology that sends no pointer or focus event
    const left = probe ? PATIENCE - (clock() - probe.at) : 0;
    if (waiting) { // a later plain click on an app link replaces the one still waiting
      event.preventDefault(); waiting.item = item; busy(item);
      if (left <= 0) go(waiting);
      return;
    }
    busy(item);
    if (left <= 0) { rest = setTimer(idle, 5000); return; } // it goes now, to where its href already points
    event.preventDefault();
    const token = waiting = {item, timer:setTimer(() => go(token), left)};
    probe.done.then(() => go(token));
    watch(true);
  }
  function go(token) {
    if (waiting !== token) return;
    release();
    rest = setTimer(idle, 5000); // in case the navigation is stopped
    location.assign(current()?.status ? entry.destinations(token.item.app, token.item.hash).main : token.item.url);
  }
  function release() { clearTimer(waiting.timer); waiting = null; watch(false); }
  // Whatever the visitor starts while a click waits wins: another link, a typed address, Back or Reload; Escape cancels.
  function drop() { if (waiting) { release(); idle(); } }
  const escape = event => { if (event.key === 'Escape') drop(); };
  const navigating = event => { if (!event.destination?.sameDocument && event.downloadRequest == null) drop(); };
  function watch(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    win[method]('beforeunload', drop); win[method]('keydown', escape); win.navigation?.[method]('navigate', navigating);
  }
  // Leaving aborts the probe and any waiting click; a page restored from the back/forward cache starts clean.
  function reset() {
    probe?.controller.abort(); probe = null;
    if (waiting) release();
    clearTimer(expiry); clearTimer(rest); result = null;
    idle(); apply();
  }

  for (const item of items) {
    const {link} = item;
    for (const type of ['pointerenter', 'pointermove']) link.addEventListener(type, hover);
    for (const type of ['pointerdown', 'focus']) link.addEventListener(type, intent);
    link.addEventListener('touchstart', intent, {passive:true});
    link.addEventListener('click', click);
    // Copy Link, Open in New Tab and bookmarks from the context menu keep the public entry URL, which works anywhere.
    link.addEventListener('contextmenu', () => { if (link.getAttribute('href') !== item.href) link.setAttribute('href', item.href); });
  }
  win.addEventListener('pagehide', reset);
  win.addEventListener('pageshow', event => { if (event.persisted) reset(); });
  return items.length;
}

if (typeof document !== 'undefined') enhanceEntryLinks({doc:document, win:window, location:window.location,
  fetchImpl:window.fetch.bind(window), permissions:navigator.permissions});
