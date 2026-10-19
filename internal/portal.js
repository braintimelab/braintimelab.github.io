const MEMBER_ROLES = new Set(['owner', 'manager', 'editor', 'viewer']);
const MEMBER_LEVELS = new Set(['low', 'mid', 'mid1', 'mid2', 'high', 'max']);
const CALLBACK_KEYS = ['access_token', 'refresh_token', 'error', 'error_description', 'error_code'];

export function togglePasswordVisibility(input, button, show = input.type === 'password') {
  input.type = show ? 'text' : 'password';
  const label = show ? 'Hide password' : 'Show password';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', String(show));
}

/** Small view controller. Authentication, refresh and membership stay in the shared store. */
export function createPortalController({store, config, location, navigate, onState = () => {}}) {
  let generation = 0;
  let state = Object.freeze({phase: 'checking', busy: true, message: 'Checking your session…', error: false, identity: '', hasSession: false, notice: null, memberDocuments: false});
  const appURL = () => new URL('../mouse-data/', location.href).href;
  const reagentsURL = () => new URL('../reagents/', location.href).href;
  const publish = update => {
    const next = {...state, ...update};
    if (next.phase !== 'member') next.memberDocuments = false;
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
    return publish({phase: 'member', busy: false, message: '', error: false, identity: current.email || current.username || 'Signed in', hasSession: true, notice: null,
      memberDocuments: current.guestLevel === null && MEMBER_LEVELS.has(current.exportLevel)});
  }

  function failed(error, attempt) {
    if (attempt !== generation) return state;
    return publish({phase: 'signed-out', busy: false, message: message(error), error: true, identity: '', hasSession: store.getCloudStatus().signedIn === true});
  }

  async function checkAccess() {
    const attempt = ++generation;
    publish({phase: 'checking', busy: true, message: 'Checking your session…', error: false, identity: '', notice: null});
    try {
      configure();
      return await resolveAccess(attempt);
    } catch (error) { return failed(error, attempt); }
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
    const attempt = ++generation;
    publish({phase: 'signed-out', busy: true, message: 'Signing in…', error: false, identity: '', notice: null});
    try {
      configure();
      await store.signIn(identifier, password);
      if (attempt !== generation) return state;
      return await resolveAccess(attempt);
    } catch (error) { return failed(error, attempt); }
  }

  async function signOut() {
    const attempt = ++generation;
    // Hide tools immediately, including while cache cleanup and the logout request finish.
    publish({phase: 'signed-out', busy: true, message: 'Signing out…', error: false, identity: '', hasSession: false, notice: null});
    try {
      await store.signOut();
      if (attempt === generation) publish({busy: false, message: 'You’re signed out.'});
    } catch {
      if (attempt === generation) publish({busy: false, error: true, message: 'Signed out. Browser cleanup could not finish; close this tab before leaving a shared device.'});
    }
    return state;
  }

  async function sendRequest(target, action) {
    const attempt = ++generation;
    publish({busy: true, message: '', error: false, notice: {target, text: 'Requesting your link…'}});
    try {
      configure();
      await action();
      if (attempt === generation) publish({busy: false, notice: {target, text: target === 'reset'
        ? 'If this account is eligible, check its registered email and spam folder for a password reset link.'
        : 'Check your registered email for a sign-in link. It will open Mouse Data.'}});
    } catch (error) {
      if (attempt === generation) publish({busy: false, notice: {target, text: message(error)}});
    }
    return state;
  }

  async function openTool(url) {
    const checking = checkAccess();
    const attempt = generation;
    await checking;
    if (attempt === generation && state.phase === 'member') navigate(url, {replace: false});
    return state;
  }
  const openMouseData = () => openTool(appURL());
  const openReagents = () => openTool(reagentsURL());

  return Object.freeze({
    start, checkAccess, signIn, signOut, openMouseData, openReagents,
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
  const store = await import('../mouse-data/data-store.js?v=151');
  const controller = createPortalController({
    store, config: PUBLIC_CONFIG, location: window.location,
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
      element('member-identity').textContent = state.identity;
      element('main').setAttribute('aria-busy', String(state.busy));
      for (const button of document.querySelectorAll('button')) button.disabled = state.busy;
      element('reset-status').textContent = state.notice?.target === 'reset' ? state.notice.text : '';
      element('email-link-status').textContent = state.notice?.target === 'email' ? state.notice.text : '';
      const recovery = state.phase === 'recovery';
      element('account-heading').textContent = recovery ? 'Reset your password' : 'Complete your account';
      element('account-message').textContent = recovery
        ? 'Finish resetting your password in Mouse Data before opening the lab tools.'
        : 'Finish setting up your ID and password in Mouse Data to open the lab tools.';
      element('account-link').textContent = recovery ? 'Continue password reset' : 'Continue account setup';
    }
  });
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
  for (const [id, open] of [['open-mouse-data', controller.openMouseData], ['open-reagents', controller.openReagents]]) {
    element(id).addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void open();
    });
  }
  const recheck = () => {
    if (!document.hidden && !controller.getState().busy) void controller.checkAccess();
  };
  window.addEventListener('focus', recheck);
  window.addEventListener('pageshow', event => { if (event.persisted) recheck(); });
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('storage', event => { if (event.key === 'mouse-colony.cloud.v1') recheck(); });
  await controller.start();
  return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  void mountPortal(document, window).catch(() => {
    document.getElementById('portal-status').textContent = 'The sign-in page could not load. Check your connection and reload this page.';
    document.getElementById('portal-status').dataset.error = 'true';
  });
}
