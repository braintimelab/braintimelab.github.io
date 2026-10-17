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
    dataset: dataAttrs(values), classes, parentElement: parent, isConnected: true,
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
function twoFingerDrop(ui, source, destination, { move = true } = {}) {
  const first = touch(1, source, 10, 10), second = touch(2, source, 30, 10);
  send(ui, 'touchstart', [first], [first]);
  const armed = send(ui, 'touchstart', [first, second], [second]);
  ui.host.hit = destination;
  const moved = move ? send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 130, 10)]) : null;
  const ended = send(ui, 'touchend', [touch(2, source, 130, 10)], [touch(1, source, 110, 10)]);
  send(ui, 'touchend', [], [touch(2, source, 130, 10)]);
  return { armed, moved, ended };
}

test('one-finger panning stays native and cannot stage a cage move through Pointer Events', () => {
  const ui = harness(), source = cageTarget(ui.host, 'P1'), destination = cageTarget(ui.host, 'P2');
  assert.match(ui.host.innerHTML, /\.sheet-cage-drag-region,\[data-sheet-drag-mouse\]\{touch-action:auto;/);
  const start = send(ui, 'touchstart', [touch(1, source)]);
  ui.host.hit = destination;
  const move = send(ui, 'touchmove', [touch(1, source, 110, 10)]);
  let prevented = false;
  for (const event of ['onpointerdown', 'onpointermove', 'onpointerup']) ui.host[event]({ pointerType: 'touch', pointerId: 1, target: source, clientX: event === 'onpointerdown' ? 10 : 110, clientY: 10, preventDefault() { prevented = true; } });
  const end = send(ui, 'touchend', [], [touch(1, source, 110, 10)]);
  assert.equal(start.prevented || move.prevented || end.prevented || prevented, false);
  ui.host.onclick({ target: source, preventDefault() {} });
  assert.doesNotMatch(ui.host.innerHTML, /class="sheet-move-notice"/);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0);
});

test('two fingers on a cage header stage a cross-room swap, then Save updates cages and resident mice together', async () => {
  const ui = harness(), before = structuredClone(ui.data), source = cageTarget(ui.host, 'P1'), destination = cageTarget(ui.host, 'P2');
  const { armed, moved } = twoFingerDrop(ui, source, destination);
  assert.equal(armed.prevented, true); assert.equal(moved.prevented, true);
  assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0); assert.deepEqual(ui.data, before);
  await ui.sync(); assert.equal(ui.saved.length, 1);
  const { next, options } = ui.saved[0];
  assert.deepEqual(next.tables.cages.map(c => [c.cage_sid, c.location_id, c.cage_tag, c.room_id, c.rack_id]), [['C1', 'P2', 'B2', 'R2', 'K2'], ['C2', 'P1', 'A1', 'R1', 'K1']]);
  assert.deepEqual(next.tables.mice.map(m => [m.mouse_sid, m.cage_sid, m.cage_tag]), [['10001', 'C1', 'B2'], ['10002', 'C2', 'A1']]);
  assert.equal(next.tables.husbandry_events.filter(e => e.event_type === 'cage_location_assignment').length, 2);
  assert.ok(Array.isArray(options.readDependencies));
});

test('source-only cage uses the same gesture and is registered only when its draft is saved', async () => {
  const ui = harness(sample({ source: true, occupied: false })), before = structuredClone(ui.data);
  twoFingerDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'));
  assert.equal(ui.saved.length, 0); assert.equal(hasCageSheetDrafts(), true); assert.deepEqual(ui.data, before);
  await ui.sync(); const next = ui.saved[0].next, cage = next.tables.cages[0];
  assert.equal(next.tables.cages.length, 1); assert.equal(cage.location_id, 'P2'); assert.equal(cage.cage_tag, 'B2');
  assert.equal(cage.start_date, '2026-09-01'); assert.equal(next.tables.mice[0].cage_sid, cage.cage_sid); assert.equal(next.tables.mice[0].cage_tag, 'B2');
});

test('Save rechecks a fresh destination and retains the touch draft when another cage arrived', async () => {
  const data = sample({ occupied: false }), fresh = structuredClone(data), ui = harness(data, { loadFresh: async () => fresh });
  twoFingerDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'));
  fresh.tables.cages.push({ cage_sid: 'REMOTE', cage_tag: 'B2', state: 'Active', location_id: 'P2', room_id: 'R2', rack_id: 'K2' });
  await ui.sync(); assert.equal(ui.saved.length, 0); assert.equal(hasCageSheetDrafts(), true);
  assert.match(ui.host.innerHTML, /changed|occupied/); assert.equal(data.tables.cages[0].location_id, 'P1');
});

test('two source-only cages exchange positions without duplicating source animals', async () => {
  const ui = harness(sample({ source: true }));
  twoFingerDrop(ui, cageTarget(ui.host, 'P1'), cageTarget(ui.host, 'P2'));
  assert.equal(ui.saved.length, 0); await ui.sync();
  const next = ui.saved[0].next;
  assert.equal(next.tables.cages.length, 2); assert.equal(next.tables.mice.length, 2);
  for (const [mouseSid, position] of [['10001', 'P2'], ['10002', 'P1']]) {
    const mouse = next.tables.mice.find(m => m.mouse_sid === mouseSid);
    assert.equal(next.tables.cages.find(c => c.cage_sid === mouse.cage_sid).location_id, position);
  }
});

test('a second finger arriving after one-finger scrolling cannot convert navigation into a move', () => {
  const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, source)]); assert.equal(send(ui, 'touchmove', [touch(1, source, 20, 10)]).prevented, false);
  const joined = send(ui, 'touchstart', [touch(1, source, 20, 10), touch(2, source, 40, 10)], [touch(2, source, 40, 10)]);
  const moved = send(ui, 'touchmove', [touch(1, source, 120, 10), touch(2, source, 140, 10)]);
  send(ui, 'touchend', [touch(2, source)], [touch(1, source)]);
  assert.equal(joined.prevented || moved.prevented, false); assert.equal(hasCageSheetDrafts(), false);
});

test('sub-threshold two-finger contact and a pinch do not stage a cage move', () => {
  for (const pinch of [false, true]) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); send(ui, 'touchstart', [touch(1, source), touch(2, source, 30, 10)]);
    send(ui, 'touchmove', [touch(1, source, pinch ? -10 : 13, 10), touch(2, source, pinch ? 50 : 33, 10)]);
    if (pinch) send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 170, 10)]);
    send(ui, 'touchend', [touch(2, source)], [touch(1, source)]);
    assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0);
  }
});

test('two-finger starts across different cages or nested controls cannot grab a cage', () => {
  for (const control of ['button', 'input', 'select', 'textarea', 'a', 'summary', 'details', null]) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'), other = control ? node(ui.host, control, {}, source.header) : cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); const start = send(ui, 'touchstart', [touch(1, source), touch(2, other, 30, 10)]);
    ui.host.hit = cageTarget(ui.host, 'P2'); send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, other, 130, 10)]); send(ui, 'touchend', [], [touch(1, source), touch(2, other)]);
    assert.equal(start.prevented, false, control || 'different cages'); assert.equal(hasCageSheetDrafts(), false);
  }
});

test('third finger, cancellation and uncancelable events discard the gesture without changes', () => {
  for (const reason of ['third', 'cancel', 'uncancelable', 'uncancelable-end']) {
    const ui = harness(), source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); send(ui, 'touchstart', [touch(1, source), touch(2, source, 30, 10)]);
    send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 130, 10)]);
    if (reason === 'third') send(ui, 'touchstart', [touch(1, source), touch(2, source), touch(3, source)], [touch(3, source)]);
    if (reason === 'cancel') send(ui, 'touchcancel', [], [touch(1, source), touch(2, source)]);
    if (reason === 'uncancelable') send(ui, 'touchmove', [touch(1, source, 115, 10), touch(2, source, 135, 10)], undefined, { cancelable: false });
    send(ui, 'touchend', [], [touch(1, source), touch(2, source)], { cancelable: reason !== 'uncancelable-end' });
    assert.equal(hasCageSheetDrafts(), false, reason); assert.equal(ui.saved.length, 0);
  }
});

test('readonly, missing housing permission and changed account forbid touch movement', () => {
  for (const mode of ['readonly', 'permission', 'account']) {
    let context = 'touch-fixture', allowed = true;
    const ui = harness(sample(), { readOnly: mode === 'readonly', canEdit: () => allowed, currentContext: () => context });
    const source = cageTarget(ui.host, 'P1'), destination = cageTarget(ui.host, 'P2');
    send(ui, 'touchstart', [touch(1, source)]); send(ui, 'touchstart', [touch(1, source), touch(2, source, 30, 10)]);
    if (mode === 'permission') allowed = false; if (mode === 'account') context = 'different-account';
    ui.host.hit = destination; send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 130, 10)]); send(ui, 'touchend', [], [touch(1, source), touch(2, source)]);
    assert.equal(hasCageSheetDrafts(), false, mode); assert.equal(ui.saved.length, 0);
  }
});

test('native HTML drag cannot bypass recent touch, while the desktop pointer path still works', async () => {
  const ui = harness(), source = cageTarget(ui.host, 'P1'), destination = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, source)]); let blocked = false;
  ui.host.ondragstart({ target: source, preventDefault() { blocked = true; }, dataTransfer: { setData() { assert.fail('touch started native drag'); } } });
  assert.equal(blocked, true); send(ui, 'touchend', [], [touch(1, source)]); assert.equal(hasCageSheetDrafts(), false);
  ui.host.hit = destination;
  ui.host.onpointerdown({ pointerType: 'mouse', pointerId: 7, button: 0, target: source, clientX: 10, clientY: 10 });
  ui.host.onpointermove({ pointerType: 'mouse', pointerId: 7, target: source, clientX: 110, clientY: 10, preventDefault() {} });
  ui.host.onpointerup({ pointerType: 'mouse', pointerId: 7, target: source, clientX: 110, clientY: 10, preventDefault() {} });
  assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0); await ui.sync(); assert.equal(ui.saved.length, 1);
});

test('rerender removes old non-passive listeners and cancels captured gestures', () => {
  const ui = harness(), source = cageTarget(ui.host, 'P1');
  send(ui, 'touchstart', [touch(1, source)]); send(ui, 'touchstart', [touch(1, source), touch(2, source, 30, 10)]);
  const oldListeners = [...ui.host.listeners].flatMap(([type, set]) => [...set].map(listener => ({ type, listener })));
  ui.rerender();
  for (const { type, listener } of oldListeners) assert.equal(ui.host.listeners.get(type)?.has(listener), false);
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    assert.equal(ui.host.listeners.get(type)?.size, 1, type);
    assert.ok(ui.host.listenerAdds.filter(entry => entry.type === type).every(entry => entry.options?.passive === false));
  }
  ui.host.hit = cageTarget(ui.host, 'P2'); send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 130, 10)]); send(ui, 'touchend', [], [touch(1, source), touch(2, source)]);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0);
});

test('an asynchronous manager refresh cancels the gesture before replacing its origin', async () => {
  let finish;
  const ui = harness(sample(), { loadManagers: () => new Promise(resolve => { finish = resolve; }) });
  const source = cageTarget(ui.host, 'P1'); ui.host.hit = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, source)]); send(ui, 'touchstart', [touch(1, source), touch(2, source, 30, 10)]);
  send(ui, 'touchmove', [touch(1, source, 110, 10), touch(2, source, 130, 10)]);
  finish([]); await Promise.resolve();
  assert.equal(source.isConnected, false);
  ui.host.hit = cageTarget(ui.host, 'P2'); send(ui, 'touchend', [], [touch(1, source), touch(2, source)]);
  assert.equal(hasCageSheetDrafts(), false); assert.equal(ui.saved.length, 0);
  assert.equal(ui.host.listeners.get('touchstart').size, 1);
});

test('two-finger mouse badge movement stages only its animal and Save retains identity and cage dependencies', async () => {
  const ui = harness(), { badge, line } = badgeTarget(ui.host, 'P1'), second = node(ui.host, 'span', {}, line), destination = cageTarget(ui.host, 'P2');
  send(ui, 'touchstart', [touch(1, badge)]); const start = send(ui, 'touchstart', [touch(1, badge), touch(2, second, 30, 10)], [touch(2, second, 30, 10)]);
  ui.host.hit = destination; send(ui, 'touchmove', [touch(1, badge, 110, 10), touch(2, second, 130, 10)]); send(ui, 'touchend', [], [touch(1, badge), touch(2, second)]);
  assert.equal(start.prevented, true); assert.equal(hasCageSheetDrafts(), true); assert.equal(ui.saved.length, 0);
  await ui.sync(); const { next, options } = ui.saved[0];
  assert.deepEqual(next.tables.mice.map(m => [m.mouse_sid, m.cage_sid, m.cage_tag]), [['10001', 'C2', 'B2'], ['10002', 'C2', 'B2']]);
  assert.equal(next.tables.cages[0].location_id, 'P1'); assert.equal(next.tables.cages[1].location_id, 'P2');
  assert.ok(options.readDependencies.some(d => d.type === 'locations' && d.id === 'P2')); assert.ok(options.readDependencies.some(d => d.type === 'cages' && d.id === 'C2'));
});
