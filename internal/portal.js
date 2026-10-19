import {createPresence,cloudPresenceContext,mergePresenceFeeds} from '../mouse-data/presence.js?v=156';
import {guestAllows} from '../mouse-data/guest-access.js?v=155';
import {createAccessActivity} from '../mouse-data/access-activity.js?v=152';

const MEMBER_ROLES = new Set(['owner', 'manager', 'editor', 'viewer']);
const MEMBER_LEVELS = new Set(['low', 'mid', 'mid1', 'mid2', 'high', 'max']);
const NO_SHORTCUTS = Object.freeze({});
const CALLBACK_KEYS = ['access_token', 'refresh_token', 'error', 'error_description', 'error_code'];

export function togglePasswordVisibility(input, button, show = input.type === 'password') {
  input.type = show ? 'text' : 'password';
  const label = show ? 'Hide password' : 'Show password';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', String(show));
}

/** Small view controller. Authentication, refresh and membership stay in the shared store. */
export function createPortalController({store, config, location, navigate, onState = () => {}, timers = globalThis, deadlineMs = 45000, isVisible = () => true}) {
  let generation = 0, pendingCheck = null, pendingAction = null;
  let verifiedIdentity = '';
  let state = Object.freeze({phase: 'checking', busy: true, message: 'Checking your session…', error: false, identity: '', hasSession: false, notice: null, memberDocuments: false, shortcuts: NO_SHORTCUTS});
  const identityKey = current => JSON.stringify([current.url, current.colonyId, current.email, current.role, current.signedIn, current.passwordRecovery, current.setupRequired]);
  const activity = createAccessActivity({app: 'lab-tools', sections: ['tools'], record: store.recordAppAccess,
    // A data-free membership check verifies portal access even before Mouse Data
    // has selected its dataset mode. Do not load animal records for activity.
    getContext: () => { const current = store.getCloudStatus(); return verifiedIdentity && identityKey(current) === verifiedIdentity ? {...current, mode: 'cloud'} : null; },
    isVisible, setTimer: (fn, delay) => timers.setTimeout(fn, delay), clearTimer: timer => timers.clearTimeout(timer)});
  const appURL = () => new URL('../mouse-data/', location.href).href;
  const reagentsURL = () => new URL('../reagents/', location.href).href;
  const publish = update => {
    const next = {...state, ...update};
    if (next.phase !== 'member') { next.memberDocuments = false; next.shortcuts = NO_SHORTCUTS; }
    if (!['member', 'checking'].includes(next.phase)) { verifiedIdentity = ''; activity.reset(); }
    state = Object.freeze(next);
    onState(state);
    return state;
  };
  const message = error => error instanceof TypeError
    ? 'Unable to reach the lab sign-in service. Check your connection and try again.'
    : error?.message || 'Sign-in could not be verified. Please try again.';

  function configure() {
    const current = store.getCloudStatus();
    // This portal belongs to the published lab, even if a previous workspace used another project.
    if (!current.configured || current.url !== config.url || current.colonyId !== config.colonyId) store.configureCloud(config);
  }

  async function resolveAccess(attempt) {
    let current = store.getCloudStatus();
    if (attempt !== generation) return state;
    if (!current.signedIn) return publish({phase: 'signed-out', busy: false, message: '', error: false, identity: '', hasSession: false});
    if (current.passwordRecovery) return publish({phase: 'recovery', busy: false, message: '', error: false, identity: '', hasSession: true});
    if (current.setupRequired || current.role === 'pending') return publish({phase: 'setup', busy: false, message: '', error: false, identity: '', hasSession: true});
    current = await store.verifyCloudMembership();
    if (attempt !== generation) return state;
    if (!current.signedIn || current.passwordRecovery || current.setupRequired || !MEMBER_ROLES.has(current.role)
      || current.url !== config.url || current.colonyId !== config.colonyId) throw new Error('Your lab access could not be verified. Sign in again.');
    verifiedIdentity = identityKey(current);
    const verified = publish({phase: 'member', busy: false, message: '', error: false, identity: current.email || current.username || 'Signed in', hasSession: true, notice: null,
      memberDocuments: current.guestLevel === null && MEMBER_LEVELS.has(current.exportLevel),
      shortcuts: Object.freeze(Object.fromEntries([['mouse-data:cages', 'mouse.cages.read'], ['mouse-data:mice', 'mouse.mice.read'], ['reagents:orders', 'reagents.orders.read'], ['reagents:inventory', 'reagents.inventory.read']]
        .map(([key, permission]) => [key, (current.guestLevel === null || ['guest1', 'guest2', 'guest3'].includes(current.guestLevel)) && guestAllows(current, permission)])))});
    // Record only a verified, visible member visit. This never delays sign-in.
    activity.resume('tools');
    return verified;
  }

  function failed(error, attempt) {
    if (attempt !== generation) return state;
    return publish({phase: 'signed-out', busy: false, message: message(error), error: true, identity: '', hasSession: store.getCloudStatus().signedIn === true});
  }

  function bounded(work, kind = 'check') {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = timers.setTimeout(() => reject(Object.assign(new Error(kind === 'reset' || kind === 'email'
        ? 'The email request was not confirmed. Check your inbox before requesting another link.'
        : 'The sign-in service is taking too long. Retry the session check or use a BraintimeDisk service.'), {portalTimeout: true})), deadlineMs);
    });
    const operation = new Promise((resolve, reject) => { try { resolve(work()); } catch (error) { reject(error); } });
    return Promise.race([operation, deadline]).finally(() => timers.clearTimeout(timer));
  }

  function failure(error, attempt) {
    if (error?.portalTimeout && attempt === generation) return failed(error, ++generation);
    return failed(error, attempt);
  }

  async function checkAccess() {
    if (pendingAction) return state;
    if (pendingCheck) return pendingCheck.promise;
    const check = {attempt: ++generation, promise: null};
    pendingCheck = check;
    publish({phase: 'checking', busy: true, message: 'Checking your session…', error: false, identity: '', notice: null});
    check.promise = (async () => {
      try {
        configure();
        return await bounded(() => resolveAccess(check.attempt));
      } catch (error) { return failure(error, check.attempt); }
      finally { if (pendingCheck === check) pendingCheck = null; }
    })();
    return check.promise;
  }

  async function start() {
    try {
      configure();
      const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (CALLBACK_KEYS.some(key => fragment.has(key))) {
        // Callback verification and password recovery have a single implementation in Mouse Data.
        // Replace this history entry; never put callback contents in a message, DOM or log.
        publish({phase: 'redirecting', busy: true, message: 'Opening your secure sign-in link…', error: false, identity: ''});
        navigate(`${appURL()}${location.hash}`, {replace: true});
        return state;
      }
      return await checkAccess();
    } catch (error) { return failed(error, generation); }
  }

  async function signIn(identifier, password) {
    if (pendingAction) return state;
    const action = {attempt: ++generation};
    pendingAction = action;
    pendingCheck = null;
    publish({phase: 'signed-out', busy: true, message: 'Signing in…', error: false, identity: '', notice: null});
    try {
      configure();
      return await bounded(async () => {
        await store.signIn(identifier, password);
        if (action.attempt !== generation) return state;
        return resolveAccess(action.attempt);
      }, 'sign-in');
    } catch (error) { return failure(error, action.attempt); }
    finally { if (pendingAction === action) pendingAction = null; }
  }

  async function signOut() {
    if (pendingAction?.kind === 'sign-out') return state;
    activity.signOut('tools');
    const action = {attempt: ++generation, kind: 'sign-out'};
    pendingAction = action;
    pendingCheck = null;
    // Hide tools immediately, including while cache cleanup and logout finish.
    publish({phase: 'signed-out', busy: true, message: 'Signing out…', error: false, identity: '', hasSession: false, notice: null});
    try {
      await bounded(() => store.signOut(), 'sign-out');
      if (action.attempt === generation) publish({busy: false, message: 'You’re signed out.'});
    } catch {
      if (action.attempt === generation) {
        generation++;
        publish({busy: false, error: true, message: 'Sign-out cleanup was not confirmed. Close this tab before leaving a shared device.'});
      }
    } finally { if (pendingAction === action) pendingAction = null; }
    return state;
  }

  async function sendRequest(target, action) {
    if (pendingAction) return state;
    const request = {attempt: ++generation};
    pendingAction = request;
    pendingCheck = null;
    publish({busy: true, message: '', error: false, notice: {target, text: 'Requesting your link…'}});
    try {
      configure();
      await bounded(action, target);
      if (request.attempt === generation) publish({busy: false, notice: {target, text: target === 'reset'
        ? 'If this account is eligible, check its registered email and spam folder for a password reset link.'
        : 'Check your registered email for a sign-in link. It will open Mouse Data.'}});
    } catch (error) {
      if (request.attempt === generation) {
        if (error?.portalTimeout) generation++;
        publish({busy: false, notice: {target, text: message(error)}});
      }
    } finally { if (pendingAction === request) pendingAction = null; }
    return state;
  }

  async function openTool(url, shortcut = null) {
    if (pendingAction) return state;
    const checking = checkAccess();
    const attempt = generation;
    await checking;
    if (attempt === generation && state.phase === 'member' && (!shortcut || state.shortcuts[shortcut])) navigate(url, {replace: false});
    return state;
  }
  const routeURL = (base, route, allowed) => {
    if (route && !allowed.includes(route)) throw new Error('Choose a supported lab tool.');
    return base + (route ? '#' + route : '');
  };
  const openMouseData = (route = '') => openTool(routeURL(appURL(), route, ['cages', 'mice']), route ? 'mouse-data:' + route : null);
  const openReagents = (route = '') => openTool(routeURL(reagentsURL(), route, ['orders', 'inventory']), route ? 'reagents:' + route : null);

  return Object.freeze({
    start, checkAccess, signIn, signOut, openMouseData, openReagents,
    suspendActivity: () => activity.suspend(),
    requestReset: identifier => sendRequest('reset', () => store.requestPasswordReset(identifier)),
    sendEmailLink: email => sendRequest('email', () => store.requestEmailLink(email, appURL())),
    getState: () => state
  });
}

export async function mountPortal(document, window) {
  const {PUBLIC_CONFIG, backupViewerLinkHTML} = await import('../mouse-data/config.js');
  const element = id => document.getElementById(id);
  togglePasswordVisibility(element('login-password'), element('show-password'), false);
  const backup = element('backup-viewer');
  backup.innerHTML = backupViewerLinkHTML(PUBLIC_CONFIG);
  backup.hidden = !backup.innerHTML;
  const store = await import('../mouse-data/data-store.js?v=156');
  let presence=null;
  const controller = createPortalController({
    store, config: PUBLIC_CONFIG, location: window.location,
    isVisible: () => !document.hidden,
    navigate: (url, {replace}) => replace ? window.location.replace(url) : window.location.assign(url),
    onState(state) {
      element('sign-in-panel').hidden = state.phase !== 'signed-out';
      element('tools-panel').hidden = state.phase !== 'member';
      for (const resource of document.querySelectorAll('[data-member-document]')) resource.hidden = state.phase !== 'member' || state.busy || !state.memberDocuments;
      element('member-account').hidden = state.phase !== 'member';
      element('account-panel').hidden = !['setup', 'recovery'].includes(state.phase);
      element('discard-session').hidden = !state.hasSession;
      element('portal-status').textContent = state.message;
      element('portal-status').dataset.error = String(state.error);
      element('portal-progress').hidden = !state.busy;
      element('portal-progress').setAttribute('aria-label', state.message || 'Working…');
      element('retry-access').hidden = state.busy || !state.error;
      for (const link of document.querySelectorAll('[data-portal-tool][data-route]')) link.hidden = state.busy || !state.shortcuts[link.dataset.portalTool + ':' + link.dataset.route];
      element('member-identity').textContent = state.identity;
      element('main').setAttribute('aria-busy', String(state.busy));
      for (const button of document.querySelectorAll('button')) button.disabled = state.busy;
      element('reset-status').textContent = state.notice?.target === 'reset' ? state.notice.text : '';
      element('email-link-status').textContent = state.notice?.target === 'email' ? state.notice.text : '';
      const recovery = state.phase === 'recovery';
      element('account-heading').textContent = recovery ? 'Reset your password' : 'Complete your account';
      element('account-message').textContent = recovery
        ? 'Finish resetting your password in Mouse Data before opening the lab tools.'
        : 'Finish setting up your username and password in Mouse Data to open the lab tools.';
      element('account-link').textContent = recovery ? 'Continue password reset' : 'Continue account setup';
      if(state.phase==='member')void presence?.refresh();else presence?.clear();
    }
  });
  presence=createPresence({app:'lab-tools',container:element('member-presence'),getContext:()=>cloudPresenceContext(store.getCloudStatus(),{enabled:controller.getState().phase==='member'}),record:store.recordAppPresence,list:async()=>{const feeds=await Promise.allSettled([store.listAppPresence(),...(store.getCloudStatus().activeCloud==='cloud2'?[]:[store.listNasPresence()])]);return mergePresenceFeeds(feeds.filter(feed=>feed.status==='fulfilled').map(feed=>feed.value));}});
  element('sign-in-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = element('login-password').value;
    element('login-password').value = '';
    togglePasswordVisibility(element('login-password'), element('show-password'), false);
    await controller.signIn(element('login-id').value.trim(), password);
  });
  element('show-password').addEventListener('click', () => togglePasswordVisibility(element('login-password'), element('show-password')));
  element('reset-form').addEventListener('submit', event => {
    event.preventDefault();
    void controller.requestReset(element('reset-id').value.trim());
  });
  element('email-link-form').addEventListener('submit', event => {
    event.preventDefault();
    void controller.sendEmailLink(element('link-email').value.trim());
  });
  for (const button of document.querySelectorAll('[data-sign-out]')) button.addEventListener('click', () => void controller.signOut());
  element('retry-access').addEventListener('click', () => void controller.checkAccess());
  for (const link of document.querySelectorAll('[data-portal-tool]')) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
      event.preventDefault();
      const open = link.dataset.portalTool === 'mouse-data' ? controller.openMouseData : controller.openReagents;
      void open(link.dataset.route || '');
    });
  }
  const concealPassword = () => togglePasswordVisibility(element('login-password'), element('show-password'), false);

  const recheck = () => {
    if (!document.hidden && !controller.getState().busy) void controller.checkAccess();
  };
  window.addEventListener('focus', recheck);
  window.addEventListener('pageshow', event => { concealPassword(); if (event.persisted) recheck(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { concealPassword(); controller.suspendActivity(); } recheck(); });
  window.addEventListener('online', recheck);
  window.addEventListener('storage', event => { if (event.key === 'mouse-colony.cloud.v1') recheck(); });
  await controller.start();
  return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  void mountPortal(document, window).catch(() => {
    document.getElementById('portal-status').textContent = 'The sign-in page could not load. Check your connection and reload this page.';
    document.getElementById('portal-status').dataset.error = 'true';
    document.getElementById('portal-progress').hidden = true;
    const retry = document.getElementById('retry-access');
    retry.hidden = false; retry.disabled = false;
    retry.addEventListener('click', () => window.location.reload(), {once: true});
  });
}
