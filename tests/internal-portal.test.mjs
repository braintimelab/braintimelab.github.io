import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPortalController} from '../internal/portal.js';

const config = {url: 'https://lab.example', colonyId: 'lab-colony', anonKey: 'public-key'};
const signedOut = () => ({...config, configured: true, signedIn: false, role: null});
const member = overrides => ({...signedOut(), signedIn: true, role: 'editor', email: 'member@example.org', ...overrides});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function fixture(options = {}) {
  const observed = [], calls = [], navigation = [];
  let status = options.status || signedOut();
  const store = {
    getCloudStatus: () => ({...status}),
    configureCloud(value) { calls.push(['configure', value]); status = signedOut(); },
    async verifyCloudMembership() {
      calls.push(['verify']);
      if (options.verification) return options.verification();
      return {...status};
    },
    async signIn(identifier, password) { calls.push(['signIn', identifier, password]); status = member(options.signedInStatus); },
    async signOut() { calls.push(['signOut']); status = signedOut(); if (options.logoutWait) await options.logoutWait; },
    async requestPasswordReset(identifier) { calls.push(['reset', identifier]); return {accepted: true}; },
    async requestEmailLink(email, redirect) { calls.push(['email', email, redirect]); return {}; }
  };
  const controller = createPortalController({
    store, config, location: new URL(options.url || 'https://braintime.example/internal/'),
    onState: value => observed.push(value), navigate: (url, mode) => navigation.push({url, ...mode})
  });
  return {controller, observed, calls, navigation, setStatus: value => { status = value; }};
}

test('fresh visitors see sign-in without any authentication or colony request', async () => {
  const f = fixture();
  await f.controller.start();
  assert.equal(f.controller.getState().phase, 'signed-out');
  assert.deepEqual(f.calls, []);
});

test('a saved role never reveals tools until the live verification succeeds', async () => {
  const waiting = deferred();
  const f = fixture({status: member(), verification: () => waiting.promise});
  const check = f.controller.start();
  assert.equal(f.controller.getState().phase, 'checking');
  assert(!f.observed.some(value => value.phase === 'member'));
  waiting.resolve(member());
  await check;
  assert.equal(f.controller.getState().phase, 'member');
  assert.equal(f.calls.filter(([action]) => action === 'verify').length, 1);
});

test('expired, revoked and unreachable sessions fail closed without trusting cached role', async () => {
  for (const reason of [new Error('Session expired'), new Error('Membership revoked'), new TypeError('fetch failed')]) {
    const f = fixture({status: member({role: 'owner'}), verification: async () => { throw reason; }});
    await f.controller.start();
    assert.equal(f.controller.getState().phase, 'signed-out');
    assert.equal(f.controller.getState().error, true);
    assert(!f.observed.some(value => value.phase === 'member'));
    assert.equal(f.navigation.length, 0);
  }
});

test('a verified refreshed session can open tools, but malformed and foreign access results cannot', async () => {
  const valid = fixture({status: member(), verification: async () => member({role: 'viewer'})});
  await valid.controller.start();
  assert.equal(valid.controller.getState().phase, 'member');
  for (const result of [member({signedIn: false}), member({role: 'unknown'}), member({passwordRecovery: true}), member({setupRequired: true}), member({colonyId: 'other'}), member({url: 'https://other.example'})]) {
    const f = fixture({status: member(), verification: async () => result});
    await f.controller.start();
    assert.equal(f.controller.getState().phase, 'signed-out');
    assert(!f.observed.some(value => value.phase === 'member'));
  }
});

test('password sign-in uses the shared store and then the independent live gate', async () => {
  const f = fixture();
  await f.controller.signIn('lab.member', 'test-only-password');
  assert.deepEqual(f.calls, [['signIn', 'lab.member', 'test-only-password'], ['verify']]);
  assert.equal(f.controller.getState().phase, 'member');
  assert(!JSON.stringify(f.observed).includes('test-only-password'));
});

test('pending and recovery sessions get only the completion panel, never tool access', async () => {
  for (const [status, phase] of [[member({role: 'pending', setupRequired: true}), 'setup'], [member({passwordRecovery: true}), 'recovery']]) {
    const f = fixture({status});
    await f.controller.start();
    assert.equal(f.controller.getState().phase, phase);
    assert.deepEqual(f.calls, []);
    assert(!f.observed.some(value => value.phase === 'member'));
  }
  const f = fixture({signedInStatus: {role: 'pending', setupRequired: true}});
  await f.controller.signIn('new@example.org', 'test-only-password');
  assert.equal(f.controller.getState().phase, 'setup');
  assert(!f.calls.some(([action]) => action === 'verify'));
});

test('sign-out immediately hides tools and a late verification cannot restore them', async () => {
  const waiting = deferred(), f = fixture({status: member(), verification: () => waiting.promise});
  const check = f.controller.start();
  await f.controller.signOut();
  waiting.resolve(member({role: 'owner'}));
  await check;
  assert.equal(f.controller.getState().phase, 'signed-out');
  assert.equal(f.controller.getState().identity, '');
  assert(!f.observed.some(value => value.phase === 'member'));
});

test('active tool access is hidden before logout finishes', async () => {
  const waiting = deferred(), f = fixture({status: member(), logoutWait: waiting.promise});
  await f.controller.start();
  const logout = f.controller.signOut();
  assert.equal(f.controller.getState().phase, 'signed-out');
  assert.equal(f.controller.getState().busy, true);
  waiting.resolve();
  await logout;
  assert.equal(f.controller.getState().busy, false);
});

test('opening Mouse Data rechecks access, including a membership revoked while the page was open', async () => {
  let permitted = true;
  const f = fixture({status: member(), verification: async () => { if (!permitted) throw Error('Membership revoked'); return member(); }});
  await f.controller.start();
  permitted = false;
  await f.controller.openMouseData();
  assert.equal(f.controller.getState().phase, 'signed-out');
  assert.equal(f.navigation.length, 0);
  permitted = true;
  await f.controller.openMouseData();
  assert.deepEqual(f.navigation, [{url: 'https://braintime.example/mouse-data/', replace: false}]);
});

test('callback credentials are transferred with replacement to the single mouse-app handler and never to view state', async () => {
  for (const type of ['recovery', 'magiclink', 'invite']) {
    const fragment = '#access_token=test-access&refresh_token=test-refresh&type=' + type;
    const f = fixture({url: 'https://braintime.example/internal/' + fragment});
    await f.controller.start();
    assert.deepEqual(f.navigation, [{url: 'https://braintime.example/mouse-data/' + fragment, replace: true}]);
    assert.deepEqual(f.calls, []);
    assert(!JSON.stringify(f.observed).includes('test-access'));
    assert(!JSON.stringify(f.observed).includes('test-refresh'));
  }
});

test('email links return to Mouse Data and reset requests preserve the generic account response', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.sendEmailLink('member@example.org');
  assert.deepEqual(f.calls[0], ['email', 'member@example.org', 'https://braintime.example/mouse-data/']);
  assert.equal(f.controller.getState().phase, 'signed-out');
  await f.controller.requestReset('lab.member');
  assert.deepEqual(f.calls[1], ['reset', 'lab.member']);
  assert.match(f.controller.getState().notice.text, /^If this account is eligible/);
});

test('a previous workspace configuration cannot grant access to this lab portal', async () => {
  const f = fixture({status: member({url: 'https://other.example', colonyId: 'other-colony'})});
  await f.controller.start();
  assert.deepEqual(f.calls, [['configure', config]]);
  assert.equal(f.controller.getState().phase, 'signed-out');
});

test('published page starts with tools hidden, accessible labels and no active Reagents link', async () => {
  const html = await readFile(new URL('../internal/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="tools-panel" hidden/);
  assert.match(html, /id="account-panel"[^>]* hidden/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /for="login-id"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /role="status"/);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert(csp);
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'", 'connect-src https://njhetwortngnniyrhcfk.supabase.co']) assert(csp.includes(directive));
  assert(!csp.includes("'unsafe-inline'"));
  const reagentCard = html.match(/<article class="tool-card upcoming"[\s\S]*?<\/article>/)?.[0];
  assert(reagentCard);
  assert.match(reagentCard, /aria-disabled="true"/);
  assert(!reagentCard.includes('<a '));
  assert(!reagentCard.includes('<button'));
});
