import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { renderCageSheet, clearCageSheetDrafts, hasCageSheetDrafts } from '../mouse-data/cage-sheet.js';
import { normalizeDataset } from '../mouse-data/model.js';

globalThis.crypto ??= webcrypto;
const decode = value => String(value ?? '').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const attrs = html => Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const dataAttrs = values => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));

function sample({ source = false, occupied = true } = {}) {
  const data = normalizeDataset({ tables: {
    mice: [{ mouse_sid: '10001', physical_tag: 'P-M001', sex: 'Male', date_of_birth: '2026-06-01', state: 'Stock', cage_sid: 'C1', cage_tag: 'A1', manager: 'JM' }],
    cages: [{ cage_sid: 'C1', cage_tag: 'A1', state: 'Active', location_id: 'P1', room_id: 'R1', rack_id: 'K1', manager: 'JM' }],
    rooms: [{ room_id: 'R1', name: 'Ani Beh' }, { room_id: 'R2', name: 'SHLAC Rat room' }],
    racks: [{ rack_id: 'K1', room_id: 'R1', name: 'Rack A' }, { rack_id: 'K2', room_id: 'R2', name: 'Rack B' }],
    locations: [{ location_id: 'P1', room_id: 'R1', rack_id: 'K1', label: 'A1' }, { location_id: 'P2', room_id: 'R2', rack_id: 'K2', label: 'B2' }],
  } });
  if (occupied) {
    data.tables.cages.push({ cage_sid: 'C2', cage_tag: 'B2', state: 'Active', location_id: 'P2', room_id: 'R2', rack_id: 'K2', manager: 'JM' });
    data.tables.mice.push({ mouse_sid: '10002', physical_tag: 'P-F002', sex: 'Female', date_of_birth: '2026-06-02', state: 'Stock', cage_sid: 'C2', cage_tag: 'B2' });
  }
  if (source) {
    data.tables.cages = [];
    Object.assign(data.tables.mice[0], { cage_sid: null, cage_tag: null });
    Object.assign(data.tables.locations[0], { source_cage_observation: { schemaVersion: 1, managerName: 'JM', startedDate: '2026-09-01', animals: [{ tag: 'P-M001', dateOfBirth: '2026-06-01', left: 0, right: 1, sourceCell: 'T10' }] } });
    if (occupied) {
      Object.assign(data.tables.mice[1], { cage_sid: null, cage_tag: null });
      Object.assign(data.tables.locations[1], { source_cage_observation: { schemaVersion: 1, managerName: 'JM', startedDate: '2026-09-02', animals: [{ tag: 'P-F002', dateOfBirth: '2026-06-02', left: 1, right: 0, sourceCell: 'T10' }] } });
    }
  }
  return data;
}

// A narrow DOM-like host calls the production renderer and its real Save path.
// Targets are reconstructed from rendered attributes, including nested controls.
function sheetHost() {
  let html = '', ids = new Map();
  const host = {
    nodes: [], listeners: new Map(), listenerAdds: [], listenerRemoves: [], hit: null,
    ownerDocument: { elementFromPoint() { return host.hit; } },
    get innerHTML() { return html; },
    set innerHTML(value) {
      for (const node of host.nodes) node.isConnected = false;
      host.nodes = []; html = value;
      ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, { disabled: false, textContent: '', querySelector() { return { textContent: '' }; } }]));
    },
    querySelector(selector) { return ids.get(selector.slice(1)) || null; },
    querySelectorAll(selector) { return host.nodes.filter(node => selector.split(',').some(part => node.matches(part))); },
    contains(node) { return host.nodes.includes(node) && node.isConnected; },
    addEventListener(type, listener, options) { if (!host.listeners.has(type)) host.listeners.set(type, new Set()); host.listeners.get(type).add(listener); host.listenerAdds.push({ type, listener, options }); },
    removeEventListener(type, listener) { host.listeners.get(type)?.delete(listener); host.listenerRemoves.push({ type, listener }); },
  };
  return host;
}
function node(host, tag, values = {}, parent = null) {
  const classes = new Set((values.class || '').split(/\s+/).filter(Boolean));
  const result = {
    dataset: dataAttrs(values), classes, parentElement: parent, isConnected: true, draggable: values.draggable === 'true',
    classList: { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); } },
    hasAttribute: key => Object.hasOwn(values, key),
    matches(selector) { return selector.split(',').some(part => part.startsWith('.') ? classes.has(part.slice(1)) : /^\[[\w-]+\]$/.test(part) ? this.hasAttribute(part.slice(1, -1)) : part === tag); },
    closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; },
    contains(target) { for (let n = target; n; n = n.parentElement) if (n === this) return true; return false; },
    getBoundingClientRect() { return { width: 174 }; },
  };
  host.nodes.push(result); return result;
}
function cageTarget(host, position, control = null) {
  const match = [...host.innerHTML.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)].find(([, values]) => attrs(values)['data-sheet-slot'] === position);
  assert.ok(match, `Position ${position} rendered`);
  const frame = node(host, 'div', { class: 'sheet-slot-frame', 'data-sheet-slot-frame': position });
  const card = node(host, 'article', attrs(match[1]), frame);
  const headerMatch = match[2].match(/<header\b([^>]*)>/);
  const header = headerMatch ? node(host, 'header', attrs(headerMatch[1]), card) : card;
  const target = node(host, control || 'strong', control ? { class: control === 'button' ? 'sheet-print-label' : '' } : {}, header);
  return Object.assign(target, { card, frame, header });
}
function badgeTarget(host, position) {
  const target = cageTarget(host, position), article = [...host.innerHTML.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)].find(([, values]) => attrs(values)['data-sheet-slot'] === position)[2];
  const match = [...article.matchAll(/<button\b([^>]*)>/g)].find(([, values]) => Object.hasOwn(attrs(values), 'data-sheet-drag-mouse'));
  assert.ok(match, 'Draggable animal badge rendered');
  const rowValues = [...article.matchAll(/<div\b([^>]*)>/g)].map(([, values]) => attrs(values)).find(values => values['data-sheet-animal-row'] === attrs(match[1])['data-sheet-drag-mouse']);
  assert.ok(rowValues, 'Rendered badge belongs to an animal row');
  const row = node(host, 'div', rowValues, target.card), line = node(host, 'div', { class: 'sheet-animal-line' }, row);
  return { badge: node(host, 'button', attrs(match[1]), line), row, line, card: target.card };
}
function harness(data = sample(), overrides = {}) {
  clearCageSheetDrafts();
  const host = sheetHost(), saved = [], hooks = { context: 'touch-fixture', currentContext: () => 'touch-fixture', canEdit: () => true, loadFresh: async () => data, save: async (next, options) => saved.push({ next, options }), ...overrides };
  renderCageSheet(host, data, hooks);
  return { host, data, hooks, saved, sync: () => host.querySelector('#cage-sheet-sync').onclick(), rerender: () => renderCageSheet(host, data, hooks) };
}
const touch = (identifier, target, clientX = 10, clientY = 10) => ({ identifier, target, clientX, clientY });
function send(ui, type, touches, changedTouches = touches, { cancelable = true } = {}) {
  const event = { type, touches, targetTouches: touches, changedTouches, target: changedTouches[0]?.target, cancelable, prevented: false, preventDefault() { this.prevented = true; } };
  for (const listener of ui.host.listeners.get(type) || []) listener(event);
  return event;
}
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-17T12:00:00Z') });
  return ms => t.mock.timers.tick(ms);
}
function holdDrop(ui, source, destination, tick) {
  const start = send(ui, 'touchstart', [touch(1, source)]);
  assert.equal(start.prevented, false, 'The pending hold must not prevent normal scrolling');
  tick(500); ui.host.hit = destination;
  const move = send(ui, 'touchmove', [touch(1, source, 110, 10)]);
  const end = send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
  return { start, move, end };
}

test('one-finger scrolling before activation stays native and cannot bypass the hold through Pointer Events', t => {
  const tick = clock(t), ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
  assert.match(ui.host.innerHTML, /touch-action:auto/);
  const start = send(ui, 'touchstart', [touch(1, source)]); tick(100);
  const move = send(ui, 'touchmove', [touch(1, source, 110, 10)]); tick(1000);
  let prevented = false;
  for (const event of ['onpointerdown', 'onpointermove', 'onpointerup']) ui.host[event]({ pointerType: 'touch', pointerId: 1, target: source, clientX: event === 'onpointerdown' ? 10 : 110, clientY: 10, preventDefault() { prevented = true; } });
  const end = send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
  assert.equal(start.prevented || move.prevented || end.prevented || prevented, false);
  ui.host.onclick({ target: source, preventDefault() {} });
  assert.doesNotMatch(ui.host.innerHTML, /class="sheet-move-notice"/);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0);
});

test('holding a cage header activates its border at 500ms; movement then stages a cross-room swap until Save', async t => {
  const tick = clock(t), ui = harness(), before = structuredClone(ui.data), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
  assert.equal(source.header.draggable, true);
  assert.equal(send(ui, 'touchstart', [touch(1, source)]).prevented, false);
  assert.equal(source.header.draggable, false, 'A pending hold disables the native HTML drag callout');
  tick(499); assert.equal(source.card.classes.has('sheet-touch-armed'), false); assert.equal(hasCageSheetDrafts(), false);
  tick(1); assert.equal(source.card.classes.has('sheet-touch-armed'), true); assert.equal(hasCageSheetDrafts(), false);
  const move = send(ui, 'touchmove', [touch(1, source, 110, 10)]); assert.equal(move.prevented, true);
  send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
  assert.equal(source.header.draggable, true, 'Native desktop dragging is restored after the gesture');
  assert.equal(source.card.classes.has('sheet-touch-armed'), false); assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0); assert.deepEqual(ui.data, before);
  await ui.sync(); assert.equal(ui.saved.length, 1);
  const { next, options } = ui.saved[0];
  assert.deepEqual(next.tables.cages.map(c => [c.cage_sid, c.location_id, c.cage_tag, c.room_id, c.rack_id]), [['C1', 'P2', 'B2', 'R2', 'K2'], ['C2', 'P1', 'A1', 'R1', 'K1']]);
  assert.deepEqual(next.tables.mice.map(m => [m.mouse_sid, m.cage_sid, m.cage_tag]), [['10001', 'C1', 'B2'], ['10002', 'C2', 'A1']]);
  assert.equal(next.tables.husbandry_events.filter(e => e.event_type === 'cage_location_assignment').length, 2); assert.ok(Array.isArray(options.readDependencies));
});

test('source-only cage hold materializes a cage only when Save is pressed', async t => {
  const tick = clock(t), ui = harness(sample({ source: true, occupied: false })), before = structuredClone(ui.data);
  holdDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'), tick);
  assert.equal(ui.saved.length, 0); assert.equal(hasCageSheetDrafts(), true); assert.deepEqual(ui.data, before);
  await ui.sync(); const next = ui.saved[0].next, cage = next.tables.cages[0];
  assert.equal(next.tables.cages.length, 1); assert.equal(cage.location_id, 'P2'); assert.equal(cage.cage_tag, 'B2');
  assert.equal(cage.start_date, '2026-09-01'); assert.equal(next.tables.mice[0].cage_sid, cage.cage_sid); assert.equal(next.tables.mice[0].cage_tag, 'B2');
});

test('Save rechecks a fresh destination and retains the touch draft when another cage arrived', async t => {
  const tick = clock(t), data = sample({ occupied: false }), fresh = structuredClone(data), ui = harness(data, { loadFresh: async () => fresh });
  holdDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'), tick);
  fresh.tables.cages.push({ cage_sid: 'REMOTE', cage_tag: 'B2', state: 'Active', location_id: 'P2', room_id: 'R2', rack_id: 'K2' });
  await ui.sync(); assert.equal(ui.saved.length, 0); assert.equal(hasCageSheetDrafts(), true);
  assert.match(ui.host.innerHTML, /changed|occupied/); assert.equal(data.tables.cages[0].location_id, 'P1');
});

test('two source-only cages exchange positions without duplicating source animals after a held drag', async t => {
  const tick = clock(t), ui = harness(sample({ source: true })); holdDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'), tick);
  assert.equal(ui.saved.length, 0); await ui.sync(); const next = ui.saved[0].next;
  assert.equal(next.tables.cages.length, 2); assert.equal(next.tables.mice.length, 2);
  for (const [mouseSid, position] of [['10001', 'P2'], ['10002', 'P1']]) {
    const mouse = next.tables.mice.find(m => m.mouse_sid === mouseSid); assert.equal(next.tables.cages.find(c => c.cage_sid === mouse.cage_sid).location_id, position);
  }
});

test('a quick tap or release after holding without movement never changes cage assignments', t => {
  const tick = clock(t);
  for (const wait of [100, 499, 500, 800]) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); tick(wait); send(ui, 'touchend', [], [touch(1, source)]);
    ui.host.onclick({ target: source, preventDefault() {} }); assert.doesNotMatch(ui.host.innerHTML, /class="sheet-move-notice"/); tick(1000);
    assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
  }
});

test('a quick tap on a print control still opens its normal action without activating drag', async t => {
  const tick = clock(t); let printed = 0;
  const ui = harness(sample(), { printLabel: () => printed++ }), source = cageTarget(ui.host, 'P1');
  const article = [...ui.host.innerHTML.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)].find(([, values]) => attrs(values)['data-sheet-slot'] === 'P1')[2];
  const values = [...article.matchAll(/<button\b([^>]*)>/g)].map(([, values]) => attrs(values)).find(values => values['data-sheet-label'] === 'C1');
  assert.ok(values); const control = node(ui.host, 'button', values, source.header);
  send(ui, 'touchstart', [touch(1, control)]); tick(100); send(ui, 'touchend', [], [touch(1, control)]);
  await ui.host.onclick({ target: control, preventDefault() {} });
  assert.equal(printed, 1); assert.equal(hasCageSheetDrafts(), false); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
});

test('native long-press callouts are suppressed only for the drag candidate and restored after cancellation', t => {
  const tick = clock(t), ui = harness(), source = cageTarget(ui.host, 'P1'), control = node(ui.host, 'button', {}, source.header);
  send(ui, 'touchstart', [touch(1, source)]); tick(100);
  let pendingPrevented = false, controlPrevented = false, afterCancelPrevented = false;
  ui.host.oncontextmenu({ target: source, preventDefault() { pendingPrevented = true; } });
  ui.host.oncontextmenu({ target: control, preventDefault() { controlPrevented = true; } });
  assert.equal(pendingPrevented, true); assert.equal(controlPrevented, false);
  send(ui, 'touchcancel', [], [touch(1, source)]); tick(1000);
  ui.host.oncontextmenu({ target: source, preventDefault() { afterCancelPrevented = true; } });
  assert.equal(afterCancelPrevented, false); assert.equal(source.header.draggable, true); assert.equal(hasCageSheetDrafts(), false);
});

test('holding nested header controls or display badges cannot arm a cage move', t => {
  const tick = clock(t);
  for (const control of ['button', 'input', 'select', 'textarea', 'a', 'summary', 'details', '.sheet-work-display']) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'), target = node(ui.host, control.startsWith('.') ? 'span' : control, { class: control.startsWith('.') ? control.slice(1) : '' }, source.header); ui.host.hit = cageTarget(ui.host, 'P2');
    const start = send(ui, 'touchstart', [touch(1, target)]); tick(800); const move = send(ui, 'touchmove', [touch(1, target, 110, 10)]); send(ui, 'touchend', [], [touch(1, target, 110, 10)]);
    assert.equal(start.prevented || move.prevented, false, control); assert.equal(hasCageSheetDrafts(), false); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
  }
});

test('a second or third finger cancels both pending and active holds without preventing pinch gestures', t => {
  const tick = clock(t);
  for (const activated of [false, true]) for (const count of [2, 3]) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); tick(activated ? 500 : 100);
    const points = Array.from({ length: count }, (_, i) => touch(i + 1, source, 10 + i * 20, 10));
    const start = send(ui, 'touchstart', points); tick(1000); const move = send(ui, 'touchmove', points.map(p => ({ ...p, clientX: p.clientX + 100 })));
    send(ui, 'touchend', [], points); assert.equal(start.prevented || move.prevented, false); assert.equal(hasCageSheetDrafts(), false); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
  }
});

test('cancellation and uncancelable events remove activation without staging changes', t => {
  const tick = clock(t);
  for (const reason of ['cancel', 'uncancelable', 'uncancelable-end']) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); tick(500); send(ui, 'touchmove', [touch(1, source, 110, 10)]);
    if (reason === 'cancel') send(ui, 'touchcancel', [], [touch(1, source)]);
    if (reason === 'uncancelable') send(ui, 'touchmove', [touch(1, source, 115, 10)], undefined, { cancelable: false });
    send(ui, 'touchend', [], [touch(1, source, 110, 10)], { cancelable: reason !== 'uncancelable-end' });
    assert.equal(hasCageSheetDrafts(), false, reason); assert.equal(ui.saved.length, 0); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
  }
});

test('readonly, revoked housing permission and changed account forbid both activation and a later drop', t => {
  const tick = clock(t);
  for (const mode of ['readonly', 'permission', 'account']) for (const afterActivation of [false, true]) {
    let context = 'touch-fixture', allowed = true;
    const ui = harness(sample(), { readOnly: mode === 'readonly', canEdit: () => allowed, currentContext: () => context }), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); if (afterActivation) tick(500);
    if (mode === 'permission') allowed = false; if (mode === 'account') context = 'different-account';
    tick(500); send(ui, 'touchmove', [touch(1, source, 110, 10)]); send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
    assert.equal(hasCageSheetDrafts(), false, mode); assert.equal(ui.saved.length, 0);
  }
});

test('native HTML drag cannot bypass recent touch, while desktop pointer movement remains available', async t => {
  clock(t); const ui = harness(), source = cageTarget(ui.host, 'P1'), destination = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, source)]); let blocked = false;
  ui.host.ondragstart({ target: source, preventDefault() { blocked = true; }, dataTransfer: { setData() { assert.fail('touch started native drag'); } } });
  assert.equal(blocked, true); send(ui, 'touchend', [], [touch(1, source)]); assert.equal(hasCageSheetDrafts(), false); ui.host.hit = destination;
  ui.host.onpointerdown({ pointerType: 'mouse', pointerId: 7, button: 0, target: source, clientX: 10, clientY: 10 });
  ui.host.onpointermove({ pointerType: 'mouse', pointerId: 7, target: source, clientX: 110, clientY: 10, preventDefault() {} });
  ui.host.onpointerup({ pointerType: 'mouse', pointerId: 7, target: source, clientX: 110, clientY: 10, preventDefault() {} });
  assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0); await ui.sync(); assert.equal(ui.saved.length, 1);
});

test('rerender removes old non-passive listeners and cancels pending hold timers', t => {
  const tick = clock(t), ui = harness(), source = cageTarget(ui.host, 'P1'); send(ui, 'touchstart', [touch(1, source)]);
  const oldListeners = [...ui.host.listeners].flatMap(([type, set]) => [...set].map(listener => ({ type, listener }))); tick(200); ui.rerender(); tick(1000);
  for (const { type, listener } of oldListeners) assert.equal(ui.host.listeners.get(type)?.has(listener), false);
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) { assert.equal(ui.host.listeners.get(type)?.size, 1, type); assert.ok(ui.host.listenerAdds.filter(entry => entry.type === type).every(entry => entry.options?.passive === false)); }
  ui.host.hit = cageTarget(ui.host, 'P2'); send(ui, 'touchmove', [touch(1, source, 110, 10)]); send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
});

test('asynchronous manager refresh cancels a highlighted hold before replacing its origin', async t => {
  const tick = clock(t); let finish;
  const ui = harness(sample(), { loadManagers: () => new Promise(resolve => { finish = resolve; }) }), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, source)]); tick(500); finish([]); await Promise.resolve(); assert.equal(source.isConnected, false);
  ui.host.hit = cageTarget(ui.host, 'P2'); send(ui, 'touchend', [], [touch(1, source)]);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0); assert.equal(ui.host.listeners.get('touchstart').size, 1); assert.equal(source.card.classes.has('sheet-touch-armed'), false);
});

test('holding a mouse badge stages only that animal and Save retains identity and destination dependencies', async t => {
  const tick = clock(t), ui = harness(), { badge } = badgeTarget(ui.host, 'P1'); holdDrop(ui, badge, cageTarget(ui.host, 'P2'), tick);
  assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0); await ui.sync(); const { next, options } = ui.saved[0];
  assert.deepEqual(next.tables.mice.map(m => [m.mouse_sid, m.cage_sid, m.cage_tag]), [['10001', 'C2', 'B2'], ['10002', 'C2', 'B2']]);
  assert.equal(next.tables.cages[0].location_id, 'P1'); assert.equal(next.tables.cages[1].location_id, 'P2');
  assert.ok(options.readDependencies.some(d => d.type === 'locations' && d.id === 'P2')); assert.ok(options.readDependencies.some(d => d.type === 'cages' && d.id === 'C2'));
});
