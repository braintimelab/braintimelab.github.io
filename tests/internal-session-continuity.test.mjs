import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {guestAllows} from '../mouse-data/guest-access.js';
import {createAccessActivity} from '../mouse-data/access-activity.js';

const config = {url: 'https://lab.example', colonyId: 'lab-colony', anonKey: 'public'};
const out = () => ({...config, configured: true, signedIn: false, role: null});
const member = overrides => ({...out(), signedIn: true, userId: '11111111-1111-4111-8111-111111111111', sessionEpoch: '1',
  role: 'editor', email: 'member@example.org', guestLevel: null, exportLevel: 'low', ...overrides});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const turn = () => new Promise(resolve => setImmediate(resolve));

async function mounted(t, {status = member(), verify, hint = 'synthetic-session-hint', hash = ''} = {}) {
  let current = status, verifier = verify, calls = 0;
  const events = new Map(), documentEvents = new Map(), elements = new Map(), listeners = new Set(), navigation = [], checks = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {id, hidden: true, type: id === 'login-password' ? 'password' : '', value: '', dataset: {},
      textContent: '', innerHTML: '', attributes: new Map(), listeners: new Map(), disabled: false,
      setAttribute(name, value) {this.attributes.set(name, value);}, addEventListener(name, fn) {this.listeners.set(name, fn);}});
    return elements.get(id);
  };
  const top = element('mouse-link'), shortcut = element('cage-link'), reagent = element('reagent-link');
  top.dataset.portalTool = shortcut.dataset.portalTool = 'mouse-data'; shortcut.dataset.route = 'cages'; reagent.dataset.portalTool = 'reagents';
  const docs = [element('protected-doc'), element('protocol-card')], links = [top, shortcut, reagent];
  const buttons = [element('show-password'), element('retry-access'), element('submit'), element('sign-out')];
  const document = {hidden: false, getElementById: element, addEventListener: (name, fn) => documentEvents.set(name, fn),
    querySelectorAll: selector => selector === '[data-member-document]' ? docs : selector === '[data-portal-tool]' ? links
      : selector === '[data-portal-tool][data-route]' ? [shortcut] : selector === '[data-sign-out]' ? [element('sign-out')]
      : selector === 'button' ? buttons : []};
  const location = new URL('https://lab.example/internal/' + hash);
  location.assign = url => navigation.push(url); location.replace = url => navigation.push(url);
  const window = {location, sessionStorage: {getItem: () => hint}, addEventListener: (name, fn) => events.set(name, fn)};
  const store = {getCloudStatus: () => ({...current}), configureCloud: () => {current = out();},
    subscribeVerifiedMembership(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    async verifyCloudMembership(options) {calls++; checks.push(options); return verifier ? verifier(options) : {...current};},
    async signOut() {current = out();}, async signIn(email) {current = member({email});},
    async requestPasswordReset() {}, async requestEmailLink() {}};
  const presence = {clears: 0, refreshes: 0, refresh() {this.refreshes++;}, clear() {this.clears++;}, destroy() {}};
  const source = (await readFile(new URL('../internal/portal.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const context = vm.createContext({URL, URLSearchParams, guestAllows, createAccessActivity, setTimeout, clearTimeout, createPresence: () => presence});
  vm.runInContext(source, context);
  const facade = await context.mountPortal(document, window, {loadStore: () => store, loadConfig: () => ({PUBLIC_CONFIG: config, backupViewerLinkHTML: () => ''})});
  t.after(() => facade.dispose());
  await turn();
  return {facade, store, element, links, docs, top, shortcut, document, events, documentEvents, navigation, presence, checks,
    get calls() {return calls;}, setStatus: value => {current = value;}, setVerify: fn => {verifier = fn;},
    emit: value => {for (const fn of listeners) fn(value ?? {...current});}};
}

function click(link, extra = {}) {
  let prevented = false;
  link.listeners.get('click')({button: 0, preventDefault() {prevented = true;}, ...extra});
  return prevented;
}

test('initial cached role never gets the member shell before a live check', async t => {
  const gate = deferred(), h = await mounted(t, {verify: () => gate.promise});
  assert.equal(h.facade.getState().phase, 'checking');
  assert.equal(h.element('tools-panel').hidden, true);
  assert.equal(h.element('sign-in-panel').hidden, false);
  assert.equal(h.facade.getState().memberShell, false);
  gate.resolve(member()); await turn();
  assert.equal(h.element('tools-panel').hidden, false);
});

test('initial pending check cannot publish old actor or Guest policy without a focus event', async t => {
  for (const change of [{userId: '22222222-2222-4222-8222-222222222222', email: 'other@example.org', sessionEpoch: '2'},
    {role: 'viewer', guestLevel: 'guest3', exportLevel: 'low'}]) {
    const old = deferred(), h = await mounted(t, {status: member({exportLevel: 'high'}), verify: () => old.promise});
    h.setStatus(member(change)); h.emit(); old.resolve(member({exportLevel: 'high'})); await turn();
    assert.notEqual(h.facade.getState().phase, 'member'); assert.equal(h.element('tools-panel').hidden, true);
    assert(h.docs.every(d => d.hidden));
  }
});

test('initial live refresh may publish current Guest policy but never old regular-member documents', async t => {
  const gate = deferred(), h = await mounted(t, {status: member({exportLevel: 'high'}), verify: () => gate.promise});
  const guest = member({role: 'viewer', guestLevel: 'guest3', exportLevel: 'low'});
  h.setStatus(guest); h.emit(); gate.resolve(guest); await turn();
  assert.equal(h.facade.getState().phase, 'member'); assert.equal(h.facade.getState().memberDocuments, false);
  assert(h.docs.every(d => d.hidden));
});

test('background focus recheck preserves only verified member shell and coalesces lifecycle reads', async t => {
  const h = await mounted(t);
  assert.equal(h.facade.getState().phase, 'member');
  const gate = deferred(); h.setVerify(() => gate.promise);
  const clears = h.presence.clears;
  h.events.get('focus')();
  assert.equal(h.facade.getState().phase, 'checking');
  assert.equal(h.facade.getState().memberShell, true);
  assert.equal(h.element('sign-in-panel').hidden, true, 'background check must not flash the login');
  assert.equal(h.element('tools-panel').hidden, false);
  assert.equal(h.element('member-account').hidden, false);
  assert.equal(h.element('member-identity').textContent, 'member@example.org');
  assert(h.docs.every(d => d.hidden)); assert.equal(h.shortcut.hidden, true);
  assert(h.presence.clears > clears);
  assert(h.links.every(link => link.attributes.get('aria-disabled') === 'true'));
  assert.equal(click(h.top), true); assert.equal(click(h.top, {metaKey: true}), true);
  assert.deepEqual(h.navigation, []);
  h.events.get('focus')(); h.events.get('online')(); h.documentEvents.get('visibilitychange')();
  assert.equal(h.calls, 2, 'one initial verification and one coalesced recheck');
  gate.resolve(member()); await turn();
  assert.equal(h.facade.getState().phase, 'member'); assert(h.docs.every(d => !d.hidden));
  assert.equal(h.top.attributes.get('aria-disabled'), 'false');
});

test('verification failure conceals member shell and cannot preserve cached authority', async t => {
  const h = await mounted(t), gate = deferred(); h.setVerify(() => gate.promise);
  const check = h.facade.checkAccess(); assert.equal(h.element('tools-panel').hidden, false);
  gate.reject(Error('Access revoked')); await check;
  assert.equal(h.facade.getState().phase, 'signed-out'); assert.equal(h.facade.getState().memberShell, false);
  assert.equal(h.element('tools-panel').hidden, true); assert.equal(h.element('member-account').hidden, true);
  assert.equal(h.element('member-identity').textContent, ''); assert(h.docs.every(d => d.hidden));
  const next = deferred(); h.setVerify(() => next.promise); const retry = h.facade.checkAccess();
  assert.equal(h.element('tools-panel').hidden, true, 'failed verification cannot seed later continuity');
  next.resolve(member()); await retry;
});

test('different account, configuration, role or session generation never inherits shell continuity', async t => {
  for (const override of [{userId: '22222222-2222-4222-8222-222222222222'}, {sessionEpoch: '2'}, {email: 'other@example.org'},
    {role: 'viewer'}, {url: 'https://other.example'}, {colonyId: 'other-colony'}]) {
    const h = await mounted(t), gate = deferred(); h.setStatus(member(override)); h.setVerify(() => gate.promise);
    const check = h.facade.checkAccess();
    assert.equal(h.element('tools-panel').hidden, true, JSON.stringify(override));
    assert.equal(h.element('member-account').hidden, true);
    gate.resolve(member(override)); await check;
  }
});

test('an account switch noticed during background check fences its late result', async t => {
  const h = await mounted(t), old = deferred(), fresh = deferred(); h.setVerify(() => old.promise);
  const checking = h.facade.checkAccess(), oldFence = h.checks.at(-1).canCommit;
  const other = member({userId: '22222222-2222-4222-8222-222222222222', email: 'other@example.org', sessionEpoch: '2'});
  h.setStatus(other); h.setVerify(() => fresh.promise); h.events.get('focus')();
  assert.equal(h.element('tools-panel').hidden, true); assert.equal(oldFence(), false);
  old.resolve(member()); await checking;
  assert.equal(h.element('tools-panel').hidden, true);
  fresh.resolve(other); await turn();
  assert.equal(h.facade.getState().identity, 'other@example.org');
});

test('sign out hides the shell immediately and stale verification cannot restore it', async t => {
  const h = await mounted(t), gate = deferred(); h.setVerify(() => gate.promise);
  const checking = h.facade.checkAccess();
  const signout = h.facade.signOut();
  assert.equal(h.element('tools-panel').hidden, true); assert.equal(h.element('member-account').hidden, true);
  gate.resolve(member()); await Promise.all([checking, signout]);
  assert.equal(h.facade.getState().phase, 'signed-out'); assert.equal(h.element('tools-panel').hidden, true);
});

test('membership notification cannot transfer the pending check identity anchor', async t => {
  const h = await mounted(t), old = deferred(), fresh = deferred(); h.setVerify(() => old.promise);
  const checking = h.facade.checkAccess(), fence = h.checks.at(-1).canCommit;
  const other = member({userId: '22222222-2222-4222-8222-222222222222', email: 'other@example.org', sessionEpoch: '2'});
  h.setStatus(other); h.emit(); assert.equal(h.element('tools-panel').hidden, true);
  h.setVerify(() => fresh.promise); h.events.get('focus')(); assert.equal(fence(), false);
  old.resolve(member()); await checking; assert.equal(h.element('tools-panel').hidden, true);
  fresh.resolve(other); await turn(); assert.equal(h.facade.getState().identity, 'other@example.org');
});

test('membership change alone fences the pending result without any later focus event', async t => {
  const h = await mounted(t), old = deferred(); h.setVerify(() => old.promise);
  const checking = h.facade.checkAccess(), fence = h.checks.at(-1).canCommit;
  h.setStatus(member({userId: '22222222-2222-4222-8222-222222222222', email: 'other@example.org', sessionEpoch: '2'}));
  h.emit(); assert.equal(fence(), false); assert.equal(h.element('tools-panel').hidden, true);
  old.resolve(member()); await checking;
  assert.notEqual(h.facade.getState().phase, 'member');
  assert.equal(h.element('tools-panel').hidden, true); assert.equal(h.element('member-identity').textContent, '');
});

test('Guest, export tier and permission notifications revoke old UI and pending generation', async t => {
  for (const change of [{guestLevel: 'guest3'}, {exportLevel: 'low'}, {guestPermissions: {mouse_cages_read: false}},
    {mousePermissions: {mice_read: false}}, {reagentsPermissions: {inventory_read: false}}, {guestAccessEndsOn: '2020-01-01'}, {guestAvailability: 'expired'}]) {
    const before = member({role: 'viewer', exportLevel: 'high'}), h = await mounted(t, {status: before}), old = deferred();
    h.setVerify(() => old.promise); const checking = h.facade.checkAccess(), fence = h.checks.at(-1).canCommit;
    h.setStatus({...before, ...change}); h.emit(); assert.equal(fence(), false, JSON.stringify(change));
    old.resolve(before); await checking;
    assert.equal(h.element('tools-panel').hidden, true); assert(h.docs.every(d => d.hidden));
  }
});

test('equivalent permission object ordering does not destroy verified shell continuity', async t => {
  const h = await mounted(t, {status: member({guestPermissions: {a: true, b: false}})}), gate = deferred();
  h.setStatus(member({guestPermissions: {b: false, a: true}})); h.setVerify(() => gate.promise);
  const check = h.facade.checkAccess(); assert.equal(h.element('tools-panel').hidden, false);
  gate.resolve(member({guestPermissions: {a: true, b: false}})); await check;
});

test('setup, recovery and session loss conceal private UI instead of preserving shell', async t => {
  for (const [status, phase] of [[member({setupRequired: true}), 'setup'], [member({passwordRecovery: true}), 'recovery'], [out(), 'signed-out']]) {
    const h = await mounted(t); h.setStatus(status); await h.facade.checkAccess();
    assert.equal(h.facade.getState().phase, phase); assert.equal(h.element('tools-panel').hidden, true);
    assert.equal(h.element('member-account').hidden, true); assert(h.docs.every(d => d.hidden));
  }
});

test('a verified membership change conceals an in-flight shell immediately', async t => {
  const h = await mounted(t), gate = deferred(); h.setVerify(() => gate.promise);
  const checking = h.facade.checkAccess(); h.setStatus(out()); h.emit();
  assert.equal(h.element('tools-panel').hidden, true); assert.equal(h.element('member-account').hidden, true);
  gate.reject(Error('Membership lost')); await checking;
});

test('membership revocation and recovery notifications conceal an idle member immediately', async t => {
  for (const [status, phase] of [[out(), 'signed-out'], [member({passwordRecovery: true}), 'recovery'], [member({setupRequired: true}), 'setup']]) {
    const h = await mounted(t); h.setStatus(status); h.emit();
    assert.equal(h.facade.getState().phase, phase);
    assert.equal(h.element('tools-panel').hidden, true); assert.equal(h.element('member-account').hidden, true);
    assert(h.docs.every(d => d.hidden));
  }
});

test('normal tool navigation still requires its fresh check before navigating', async t => {
  const h = await mounted(t), gate = deferred(); h.setVerify(() => gate.promise);
  assert.equal(click(h.top), true); assert.deepEqual(h.navigation, []);
  assert.equal(h.element('sign-in-panel').hidden, true);
  gate.resolve(member()); await turn();
  assert.deepEqual(h.navigation, ['https://lab.example/mouse-data/']);
});
