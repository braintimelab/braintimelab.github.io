import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createPortalController} from '../internal/portal.js';
import {createAccessActivity} from '../mouse-data/access-activity.js';
import {guestAllows} from '../mouse-data/guest-access.js?v=134';

const config = {url: 'https://lab.example', colonyId: 'lab-colony', anonKey: 'public-key'};
const signedOut = () => ({...config, configured: true, signedIn: false, role: null});
const member = overrides => ({...signedOut(), signedIn: true, role: 'editor', email: 'member@example.org', guestLevel: null, exportLevel: 'low', ...overrides});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function clock() {
  let now = 0, sequence = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) { const id = ++sequence; pending.set(id, {callback, at: now + delay}); return id; },
    clearTimeout(id) { pending.delete(id); },
    count: () => pending.size,
    async advance(duration) {
      const end = now + duration;
      for (;;) {
        const next = [...pending].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; pending.delete(next[0]); next[1].callback(); await flush();
      }
      now = end; await flush();
    }
  };
}

function fixture({status = member(), verify, login, logout, reset, email} = {}) {
  const timers = clock(), observed = [], calls = [], navigation = [];
  let current = status;
  const store = {
    getCloudStatus: () => ({...current}),
    configureCloud() { throw Error('The existing lab configuration must be retained'); },
    async verifyCloudMembership() { calls.push(['verify']); return verify ? verify() : {...current}; },
    async signIn(identifier, password) { calls.push(['login', identifier]); if (login) await login(identifier, password); else current = member({email: identifier}); },
    async signOut() { calls.push(['logout']); current = signedOut(); if (logout) await logout(); },
    async requestPasswordReset(identifier) { calls.push(['reset', identifier]); if (reset) return reset(); },
    async requestEmailLink(address, redirect) { calls.push(['email', address, redirect]); if (email) return email(); }
  };
  const controller = createPortalController({store, config, timers, location: new URL('https://braintime.example/internal/'),
    onState: state => observed.push(state), navigate: (url, mode) => navigation.push({url, ...mode})});
  return {controller, store, timers, observed, calls, navigation, setStatus: value => { current = value; }};
}

test('session verification stops waiting at 45 seconds and ignores a late cached grant', async () => {
  const waiting = deferred(), f = fixture({verify: () => waiting.promise});
  const checking = f.controller.checkAccess();
  await f.timers.advance(44999);
  assert.equal(f.controller.getState().busy, true);
  await f.timers.advance(1); await checking;
  const failed = f.controller.getState();
  assert.equal(failed.phase, 'signed-out'); assert.equal(failed.busy, false); assert.equal(failed.error, true);
  assert.match(failed.message, /taking too long.*Retry/);
  waiting.resolve(member({role: 'owner'})); await flush();
  assert.equal(f.controller.getState(), failed); assert.equal(f.timers.count(), 0);
});

test('concurrent session checks coalesce one read, and explicit Retry can recover after timeout', async () => {
  const waiting = deferred(); let reading = () => waiting.promise;
  const f = fixture({verify: () => reading()});
  const checking = [f.controller.start(), f.controller.checkAccess(), f.controller.checkAccess()];
  assert.equal(f.calls.filter(([kind]) => kind === 'verify').length, 1);
  await f.timers.advance(45000); await Promise.all(checking);
  assert.equal(f.controller.getState().error, true);
  reading = async () => member({email: 'current@example.org'});
  await f.controller.checkAccess();
  assert.equal(f.controller.getState().phase, 'member'); assert.equal(f.controller.getState().identity, 'current@example.org');
  assert.equal(f.calls.filter(([kind]) => kind === 'verify').length, 2);
  waiting.resolve(member({role: 'owner', email: 'old@example.org'})); await flush();
  assert.equal(f.controller.getState().identity, 'current@example.org');
});

test('an old verification deadline cannot replace a newer successful login or navigate', async () => {
  const waiting = deferred(); let verifies = 0;
  const f = fixture({verify: () => ++verifies === 1 ? waiting.promise : Promise.resolve(member({email: 'new@example.org'}))});
  const opening = f.controller.openReagents('inventory');
  await f.controller.signIn('new@example.org', 'synthetic-only-password');
  const newer = f.controller.getState(); assert.equal(newer.identity, 'new@example.org');
  await f.timers.advance(45000); await opening;
  waiting.resolve(member({role: 'owner', email: 'old@example.org'})); await flush();
  assert.equal(f.controller.getState(), newer); assert.deepEqual(f.navigation, []);
});

test('a timed-out password action cannot run a late access check over a newer account', async () => {
  const waiting = deferred(); let f;
  f = fixture({status: signedOut(), login: async identifier => {
    if (identifier === 'old@example.org') return waiting.promise;
    f.setStatus(member({email: identifier}));
  }});
  const oldLogin = f.controller.signIn('old@example.org', 'synthetic-only-old');
  await f.timers.advance(45000); await oldLogin;
  assert.equal(f.controller.getState().phase, 'signed-out');
  await f.controller.signIn('new@example.org', 'synthetic-only-new');
  const current = f.controller.getState(); assert.equal(current.identity, 'new@example.org');
  waiting.resolve(); await flush();
  assert.equal(f.controller.getState(), current);
  assert.equal(f.calls.filter(([kind]) => kind === 'verify').length, 1);
  assert(!JSON.stringify(f.observed).includes('synthetic-only'));
});

test('pending email/reset actions never resend automatically and late completion stays unconfirmed', async () => {
  for (const kind of ['reset', 'email']) {
    const waiting = deferred(), f = fixture({status: signedOut(), [kind]: () => waiting.promise});
    const first = kind === 'reset' ? f.controller.requestReset('lab.member') : f.controller.sendEmailLink('member@example.org');
    await f.controller.requestReset('another.member'); await f.controller.sendEmailLink('other@example.org'); await f.controller.checkAccess();
    assert.deepEqual(f.calls.map(([action]) => action), [kind]);
    await f.timers.advance(45000); await first;
    const text = f.controller.getState().notice.text;
    assert.match(text, /not confirmed.*Check your inbox before requesting another link/);
    assert.equal(f.controller.getState().busy, false);
    waiting.resolve(); await flush();
    assert.equal(f.controller.getState().notice.text, text);
    await f.controller.checkAccess();
    assert.deepEqual(f.calls.map(([action]) => action), [kind]);
    assert.equal(f.controller.getState().phase, 'signed-out'); assert.equal(f.controller.getState().notice, null);
  }
});

test('unconfirmed sign-out stays hidden and does not falsely claim successful cleanup', async () => {
  const waiting = deferred(), f = fixture({logout: () => waiting.promise});
  await f.controller.start(); const logout = f.controller.signOut();
  await f.timers.advance(45000); await logout;
  const result = f.controller.getState();
  assert.equal(result.phase, 'signed-out'); assert.equal(result.busy, false); assert.equal(result.hasSession, false);
  assert.equal(result.memberDocuments, false); assert.deepEqual(result.shortcuts, {});
  assert.match(result.message, /cleanup was not confirmed.*Close this tab/);
  waiting.resolve(); await flush(); assert.equal(f.controller.getState(), result);
});

test('daily shortcuts use verified Guest defaults, explicit overrides and fail-closed malformed levels', async () => {
  for (const [level, allowed] of [
    ['guest1', ['mouse-data:cages', 'reagents:orders']],
    ['guest2', ['mouse-data:cages', 'reagents:orders']],
    ['guest3', ['mouse-data:cages', 'mouse-data:mice', 'reagents:orders', 'reagents:inventory']],
    ['unknown', []], [undefined, []]
  ]) {
    const f = fixture({status: member({role: 'viewer', guestLevel: level})}); await f.controller.start();
    assert.deepEqual(Object.keys(f.controller.getState().shortcuts).filter(key => f.controller.getState().shortcuts[key]), allowed);
    assert.equal(f.controller.getState().memberDocuments, false);
  }
  const f = fixture({status: member({role: 'viewer', guestLevel: 'guest1', guestPermissions: {'mouse.cages.read': false, 'mouse.mice.read': true, 'reagents.inventory.read': true, 'reagents.orders.read': false}})});
  await f.controller.start();
  assert.deepEqual(f.controller.getState().shortcuts, {'mouse-data:cages': false, 'mouse-data:mice': true, 'reagents:orders': false, 'reagents:inventory': true});
  assert.equal(f.controller.getState().memberDocuments, false);
});

test('shortcut navigation rechecks the current grant and rejects revoked or unsupported routes', async () => {
  let current = member({role: 'viewer', guestLevel: 'guest3'}), waiting;
  const f = fixture({status: current, verify: () => waiting ? waiting.promise : Promise.resolve(current)});
  await f.controller.start();
  waiting = deferred(); const opening = f.controller.openReagents('inventory');
  assert.equal(f.controller.getState().phase, 'checking'); assert.deepEqual(f.controller.getState().shortcuts, {});
  current = member({role: 'viewer', guestLevel: 'guest1'}); waiting.resolve(current); await opening;
  assert.deepEqual(f.navigation, []);
  waiting = null; current = member({role: 'viewer', guestLevel: 'guest1', guestPermissions: {'reagents.inventory.read': true}});
  await f.controller.openReagents('inventory');
  assert.deepEqual(f.navigation, [{url: 'https://braintime.example/reagents/#inventory', replace: false}]);
  assert.throws(() => f.controller.openMouseData('settings'), /supported lab tool/);
  assert.throws(() => f.controller.openReagents('inventory#settings'), /supported lab tool/);
});

async function mounted() {
  const elements = new Map(), documentEvents = new Map(), windowEvents = new Map(), timers = clock();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {type: id === 'login-password' ? 'password' : '', hidden: true, textContent: '', innerHTML: '', dataset: {}, attributes: new Map(), listeners: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); }, addEventListener(name, callback) { this.listeners.set(name, callback); }});
    return elements.get(id);
  };
  const document = {hidden: false, getElementById: element, querySelectorAll: selector => selector === 'button' ? [element('show-password'), element('retry-access')] : [], addEventListener(name, callback) { documentEvents.set(name, callback); }};
  const window = {location: new URL('https://braintime.example/internal/'), addEventListener(name, callback) { windowEvents.set(name, callback); }};
  let status = signedOut(), verify = async () => status;
  const store = {getCloudStatus: () => status, verifyCloudMembership: () => verify()};
  const source = (await readFile(new URL('../internal/portal.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
    .replace(/const \{PUBLIC_CONFIG, backupViewerLinkHTML\} = await import\('[^']+'\);/, 'const PUBLIC_CONFIG = globalThis.testConfig, backupViewerLinkHTML = () => "";')
    .replace(/const store = await import\('[^']+'\);/, 'const store = globalThis.testStore;');
  const context = vm.createContext({createPresence:()=>({refresh(){},clear(){},destroy(){}}),URL, URLSearchParams, guestAllows, createAccessActivity, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, testConfig: config, testStore: store});
  vm.runInContext(source, context);
  const controller = await context.mountPortal(document, window);
  return {element, document, documentEvents, windowEvents, controller, setStatus: value => { status = value; }, setVerify: value => { verify = value; }};
}

test('background and restored-page events conceal the password without reading or changing its value', async () => {
  const f = await mounted(), input = f.element('login-password'), button = f.element('show-password');
  Object.defineProperty(input, 'value', {get() { throw Error('Do not read the password'); }, set() { throw Error('Do not rewrite the password'); }});
  button.listeners.get('click')(); assert.equal(input.type, 'text');
  f.document.hidden = true; f.documentEvents.get('visibilitychange')();
  assert.equal(input.type, 'password'); assert.equal(button.attributes.get('aria-pressed'), 'false');
  f.document.hidden = false; button.listeners.get('click')(); assert.equal(input.type, 'text');
  f.windowEvents.get('pageshow')({persisted: true}); await flush();
  assert.equal(input.type, 'password'); assert.equal(button.attributes.get('aria-label'), 'Show password');
});

test('the mounted Retry action performs only a fresh access check and clears loading on recovery', async () => {
  const f = await mounted(); f.setStatus(member()); f.setVerify(async () => { throw Error('Temporary verification failure'); });
  await f.controller.checkAccess();
  assert.equal(f.element('retry-access').hidden, false); assert.equal(f.element('portal-progress').hidden, true);
  const waiting = deferred(); f.setVerify(() => waiting.promise);
  f.element('retry-access').listeners.get('click')();
  assert.equal(f.element('portal-progress').hidden, false); assert.equal(f.element('retry-access').hidden, true);
  waiting.resolve(member()); await flush();
  assert.equal(f.element('tools-panel').hidden, false); assert.equal(f.element('portal-progress').hidden, true);
  assert.equal(f.element('retry-access').hidden, true);
});
