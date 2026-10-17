import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { applyCageSheetDrafts, renderCageSheet, clearCageSheetDrafts, hasCageSheetDrafts } from '../mouse-data/cage-sheet.js';
import { planWorkBadgeEdit, equipmentBadgeEventId } from '../mouse-data/cage-badges.js';
import { planMouseMove } from '../mouse-data/cage-movement.js';
import { normalizeDataset } from '../mouse-data/model.js';

globalThis.crypto ??= webcrypto;
const at = '2026-10-17T04:00:00.000Z';
const edit = (type, id, field, base, value) => ({ type, id, field, base, value });
function sample() {
  return normalizeDataset({ tables: {
    mice: [{ mouse_sid: 'M1', physical_tag: 'P-M001', sex: 'Male', state: 'Stock', date_of_birth: '2026-01-01', manager: 'JM', cage_sid: 'C1', cage_tag: 'A1', genotype: 'Unknown' }],
    cages: [
      { cage_sid: 'C1', cage_tag: 'A1', manager: 'JM', state: 'Active', location_id: 'P1', room_id: 'R1', rack_id: 'K1' },
      { cage_sid: 'C2', cage_tag: 'A2', manager: 'JM', state: 'Active', location_id: 'P2', room_id: 'R1', rack_id: 'K1' },
    ],
    rooms: [{ room_id: 'R1', name: 'Clean room' }],
    racks: [{ rack_id: 'K1', room_id: 'R1', name: 'Rack A' }],
    locations: [1, 2, 3].map(n => ({ location_id: `P${n}`, label: `A${n}`, room_id: 'R1', rack_id: 'K1', row: 1, column: n })),
  } });
}
const badgePlan = (data, type, id, kind, extra = {}) => planWorkBadgeEdit(data, { type, id }, { kind, status: 'open', ...extra }, { at });
const applyPlans = (data, ...plans) => applyCageSheetDrafts(data, plans.flatMap(plan => plan.changes), { at });
const equipment = (data, id) => data.tables.husbandry_events.find(row => row.event_id === equipmentBadgeEventId(id));

// A small delegated-event host exercises the live renderer and Save handler.
// Fixtures and DOM-like nodes remain in this file; no private colony is loaded.
const decode = value => String(value ?? '').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const attributes = source => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const dataAttributes = attrs => Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
function sheetHost() {
  let html = '', nodes = new Map();
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
        disabled: false, textContent: '', querySelector() { return { textContent: '' }; },
      }]));
    },
    querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
    querySelectorAll() { return []; },
  };
}
function article(host, cageId) {
  const found = [...host.innerHTML.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)].find(([, attrs]) => attributes(attrs)['data-cage'] === cageId);
  assert.ok(found, `Cage ${cageId} is rendered`);
  return found[0];
}
function renderedButton(host, attr, value, cageId) {
  const html = cageId !== undefined ? article(host, cageId) : host.innerHTML;
  const matches = [...html.matchAll(/<button\b([^>]*)>/g)].filter(([, source]) => {
    const attrs = attributes(source);
    return value === undefined
      ? Object.hasOwn(attrs, attr) || new RegExp(`\\b${attr}(?=[\\s>]|$)`).test(source)
      : attrs[attr] === value;
  });
  assert.ok(matches.length, `Rendered button ${attr}${value === undefined ? '' : '=' + value}`);
  const source = matches[0][1], attrs = attributes(source), booleanAttrs = new Set([...source.matchAll(/\b(data-[\w-]+)(?=\s|$)/g)].map(match => match[1]));
  const button = {
    dataset: dataAttributes(attrs),
    hasAttribute: name => Object.hasOwn(attrs, name) || booleanAttrs.has(name),
    closest(selector) {
      return selector.split(',').some(part => part === 'button' || /^\[[\w-]+\]$/.test(part) && this.hasAttribute(part.slice(1, -1))) ? this : null;
    },
  };
  return button;
}
function renderHarness(data, overrides = {}) {
  clearCageSheetDrafts();
  const host = sheetHost(), saved = [];
  const hooks = { context: 'badge-fixture', currentContext: () => 'badge-fixture', canEdit: () => true, loadFresh: async () => data, save: async (next, options) => saved.push({ next, options }), ...overrides };
  renderCageSheet(host, data, hooks);
  return {
    host, saved,
    input: (dataset, value) => host.oninput({ target: { dataset, value, classList: { toggle() {} } } }),
    click: (attr, value, cageId) => host.onclick({ target: renderedButton(host, attr, value, cageId), preventDefault() {} }),
    sync: () => host.querySelector('#cage-sheet-sync').onclick(),
  };
}
async function stageBadge(ui, { cageId = 'C1', type = 'mice', id = 'M1', kind = 'genotyping', status = 'open', note = '', assignee = '', due_date = '' } = {}) {
  await ui.click('data-sheet-badges', undefined, cageId);
  ui.input({ sheetBadgeField: 'kind' }, kind);
  ui.input({ sheetBadgeField: 'target' }, JSON.stringify([type, id]));
  for (const [field, value] of Object.entries({ status, note, assignee, due_date })) ui.input({ sheetBadgeField: field }, value);
  await ui.click('data-sheet-badge-apply');
}

test('one sheet transaction saves mouse work, cage work, equipment faults and ordinary edits', () => {
  const data = sample(), before = structuredClone(data);
  const plans = [badgePlan(data, 'mice', 'M1', 'genotyping', { assignee: 'JM', due_date: '2026-10-20', note: 'Collect tail sample' }), badgePlan(data, 'cages', 'C1', 'experiment', { status: 'in_progress' }), badgePlan(data, 'locations', 'P1', 'pir')];
  const next = applyCageSheetDrafts(data, [...plans.flatMap(plan => plan.changes), edit('cages', 'C1', 'comment', null, 'Check at noon')], { at });
  assert.deepEqual(data, before);
  assert.equal(next.tables.mice[0].work_badges[0].note, 'Collect tail sample');
  assert.equal(next.tables.mice[0].work_badges[0].due_date, '2026-10-20');
  assert.equal(next.tables.cages[0].work_badges[0].status, 'in_progress');
  assert.equal(next.tables.cages[0].comment, 'Check at noon');
  assert.equal(equipment(next, 'P1').equipment_status.work_badges[0].kind, 'pir');
  assert.equal(next.tables.locations[0].work_badges, undefined);
  assert.equal(next.tables.mice[0].genotype, 'Unknown');
});

test('a concurrent mouse or cage badge edit blocks the complete save without mutating fresh data', () => {
  for (const [type, id] of [['mice', 'M1'], ['cages', 'C1']]) {
    const data = sample(), planned = badgePlan(data, type, id, 'genotyping');
    const fresh = applyPlans(data, badgePlan(data, type, id, 'genotyping', { note: 'Another editor' }));
    const before = structuredClone(fresh);
    assert.throws(() => applyCageSheetDrafts(fresh, [edit('cages', 'C2', 'comment', null, 'Must stay unsaved'), ...planned.changes], { at }), /Changed by another editor/);
    assert.deepEqual(fresh, before);
  }
});

test('an equipment conflict or invalid badge prevents all accompanying mouse and cage writes', () => {
  const data = sample(), pending = badgePlan(data, 'locations', 'P1', 'pir');
  const fresh = applyPlans(data, badgePlan(data, 'locations', 'P1', 'led'));
  const before = structuredClone(fresh);
  const changes = [edit('mice', 'M1', 'comment', null, 'Unsaved'), ...pending.changes];
  assert.throws(() => applyCageSheetDrafts(fresh, changes, { at }), /equipment status changed/i);
  assert.deepEqual(fresh, before);
  const invalid = badgePlan(data, 'mice', 'M1', 'genotyping').changes;
  invalid[0].value[0].status = 'invented';
  assert.throws(() => applyCageSheetDrafts(data, [edit('cages', 'C2', 'comment', null, 'Unsaved'), ...invalid], { at }), /open, in progress, or done/);
  assert.equal(data.tables.cages[1].comment, undefined);
});

test('badge saving checks animal, cage and physical housing permissions', () => {
  const data = sample();
  for (const [type, id] of [['mice', 'M1'], ['cages', 'C1']]) {
    const plan = badgePlan(data, type, id, 'genotyping');
    assert.throws(() => applyCageSheetDrafts(data, plan.changes, { at, canEdit: candidate => candidate !== type }), /permission/i);
  }
  const faults = badgePlan(data, 'locations', 'P3', 'pir');
  for (const denied of ['cages', 'locations']) assert.throws(() => applyCageSheetDrafts(data, faults.changes, { at, canEdit: type => type !== denied }), /Housing edit permission/);
  const next = applyCageSheetDrafts(data, faults.changes, { at, canEdit: type => ['cages', 'locations'].includes(type) });
  assert.ok(equipment(next, 'P3'));
});

test('the shared Save button commits staged mouse and cage badges with an ordinary cage note once', async () => {
  const data = sample(), before = structuredClone(data), ui = renderHarness(data);
  await stageBadge(ui, { note: 'Collect tail sample', assignee: 'JM', due_date: '2026-10-20' });
  await stageBadge(ui, { type: 'cages', id: 'C1', kind: 'experiment', status: 'in_progress' });
  ui.input({ sheetType: 'cages', sheetId: 'C1', sheetField: 'comment' }, 'Inspect water');
  assert.equal(hasCageSheetDrafts(), true);
  assert.equal(ui.saved.length, 0);
  assert.deepEqual(data, before);
  await ui.sync();
  assert.equal(ui.saved.length, 1);
  assert.equal(ui.saved[0].next.tables.mice[0].work_badges[0].note, 'Collect tail sample');
  assert.equal(ui.saved[0].next.tables.cages[0].work_badges[0].kind, 'experiment');
  assert.equal(ui.saved[0].next.tables.cages[0].comment, 'Inspect water');
  assert.equal(hasCageSheetDrafts(), false);
});

test('shared Save reloads badge conflicts and preserves the unsaved editor draft', async () => {
  const data = sample(), fresh = applyPlans(data, badgePlan(data, 'mice', 'M1', 'genotyping', { note: 'Remote work' }));
  const ui = renderHarness(data, { loadFresh: async () => fresh });
  await stageBadge(ui, { note: 'My work' });
  await ui.sync();
  assert.equal(ui.saved.length, 0);
  assert.equal(hasCageSheetDrafts(), true);
  assert.match(ui.host.innerHTML, /Changed by another editor/);
  assert.equal(fresh.tables.mice[0].work_badges[0].note, 'Remote work');
  clearCageSheetDrafts();
});

test('completed animal work stays stored and can be reopened through the badge editor', async () => {
  const data = sample(), completed = applyPlans(data, badgePlan(data, 'mice', 'M1', 'genotyping', { status: 'done', note: 'Previous sample processed' }));
  const ui = renderHarness(completed);
  assert.doesNotMatch(ui.host.innerHTML, /class="sheet-work-badge /);
  await ui.click('data-sheet-badges', undefined, 'C1');
  ui.input({ sheetBadgeField: 'target' }, JSON.stringify(['mice', 'M1']));
  assert.match(ui.host.innerHTML, /<option value="done" selected>Done<\/option>/);
  assert.match(ui.host.innerHTML, /Previous sample processed/);
  ui.input({ sheetBadgeField: 'status' }, 'open');
  await ui.click('data-sheet-badge-apply');
  await ui.sync();
  assert.equal(ui.saved.length, 1);
  assert.equal(ui.saved[0].next.tables.mice[0].work_badges.length, 1);
  assert.equal(ui.saved[0].next.tables.mice[0].work_badges[0].status, 'open');
  assert.match(article(ui.host, 'C1'), />Geno<\/span>/);
});

test('a combined mouse move and badge edit keeps animal work with its SID and faults at the original position', () => {
  const data = applyPlans(sample(), badgePlan(sample(), 'mice', 'M1', 'genotyping'), badgePlan(sample(), 'cages', 'C1', 'experiment'), badgePlan(sample(), 'locations', 'P1', 'pir'));
  const move = planMouseMove(data, 'M1', 'C2');
  const next = applyPlans(data, move, badgePlan(data, 'mice', 'M1', 'genotyping', { status: 'in_progress', note: 'Moved with mouse' }));
  assert.equal(next.tables.mice[0].cage_sid, 'C2');
  assert.equal(next.tables.mice[0].work_badges[0].note, 'Moved with mouse');
  assert.equal(next.tables.cages[0].work_badges[0].kind, 'experiment');
  assert.equal(equipment(next, 'P1').equipment_status.location_id, 'P1');
  assert.equal(equipment(next, 'P2'), undefined);
  const ui = renderHarness(next);
  assert.match(article(ui.host, 'C2'), />Geno<\/span>/);
  assert.doesNotMatch(article(ui.host, 'C2'), />PIR!<\/span>/);
  assert.match(article(ui.host, 'C1'), />PIR!<\/span>/);
});

test('empty physical positions show active equipment faults, and completed faults stop displaying', () => {
  const data = sample(), active = applyPlans(data, badgePlan(data, 'locations', 'P3', 'pir', { note: 'No activity signal' }));
  let ui = renderHarness(active);
  const empty = [...ui.host.innerHTML.matchAll(/<article\b[^>]*data-sheet-slot="P3"[^>]*>[\s\S]*?<\/article>/g)][0]?.[0];
  assert.ok(empty, 'Empty current position is present');
  assert.match(empty, /sheet-empty-slot/);
  assert.match(empty, />PIR!<\/span>/);
  const done = applyPlans(active, badgePlan(active, 'locations', 'P3', 'pir', { status: 'done' }));
  ui = renderHarness(done);
  assert.doesNotMatch(ui.host.innerHTML, />PIR!<\/span>/);
  assert.equal(equipment(done, 'P3').equipment_status.work_badges[0].status, 'done');
});

test('the empty-position equipment editor uses the same shared Save transaction', async () => {
  const data = sample(), ui = renderHarness(data);
  const empty = [...ui.host.innerHTML.matchAll(/<article\b([^>]*)>[\s\S]*?<\/article>/g)].find(([, attrs]) => attributes(attrs)['data-sheet-slot'] === 'P3');
  assert.ok(empty);
  const id = attributes(empty[1])['data-cage'];
  await stageBadge(ui, { cageId: id, type: 'locations', id: 'P3', kind: 'pir', note: 'Replace sensor' });
  assert.equal(hasCageSheetDrafts(), true);
  assert.equal(ui.saved.length, 0);
  await ui.sync();
  assert.equal(ui.saved.length, 1);
  assert.equal(equipment(ui.saved[0].next, 'P3').equipment_status.work_badges[0].note, 'Replace sensor');
});

test('current viewers can inspect badges but cannot stage edits, and historical views suppress current work', async () => {
  const data = applyPlans(sample(), badgePlan(sample(), 'mice', 'M1', 'genotyping'), badgePlan(sample(), 'locations', 'P1', 'pir'));
  let ui = renderHarness(data, { canEdit: () => false });
  assert.match(ui.host.innerHTML, />Geno<\/span>/);
  await ui.click('data-sheet-badges', undefined, 'C1');
  assert.doesNotMatch(ui.host.innerHTML, /<button[^>]*data-sheet-badge-apply/);
  ui.input({ sheetBadgeField: 'note' }, 'Cannot apply');
  assert.equal(hasCageSheetDrafts(), false);
  for (const layout of ['compact', 'detailed']) {
    ui = renderHarness(data, { layout, readOnly: true, selectedDate: '2026-10-01' });
    assert.doesNotMatch(ui.host.innerHTML, /<button[^>]*data-sheet-badge|class="sheet-work-badges"|id="cage-sheet-sync"/);
    assert.equal(hasCageSheetDrafts(), false);
  }
});

test('unknown genotypes do not create work, while existing breeding and lighting labels remain visible', () => {
  const data = sample();
  data.tables.mice.push({ ...data.tables.mice[0], mouse_sid: 'M2', physical_tag: 'P-F002', sex: 'Female' });
  data.tables.cages[0].cage_entrainment = { schemaVersion: 1, entries: [{ date: '2026-01-01', scheme: 'DD' }] };
  const before = structuredClone(data), ui = renderHarness(data);
  assert.doesNotMatch(ui.host.innerHTML, /class="sheet-work-badge /);
  assert.match(article(ui.host, 'C1'), /class="sheet-breeding-label">Breeding<\/span>/);
  assert.match(article(ui.host, 'C1'), /class="sheet-condition-label"[^>]*>DD<\/span>/);
  assert.deepEqual(data, before);
  const saved = applyPlans(data, badgePlan(data, 'mice', 'M1', 'genotyping'));
  const next = renderHarness(saved);
  assert.match(article(next.host, 'C1'), />Geno<\/span>/);
  assert.match(article(next.host, 'C1'), />Breeding<\/span>/);
  assert.match(article(next.host, 'C1'), />DD<\/span>/);
});

test('compact task and fault labels share the lighting header and remain display-only until Badges opens', async () => {
  let data = sample();
  data.tables.cages[0].cage_entrainment = { schemaVersion: 1, entries: [{ date: '2026-01-01', scheme: 'DD' }] };
  data = applyPlans(data,
    badgePlan(data, 'mice', 'M1', 'genotyping', { note: 'Check genotype' }),
    badgePlan(data, 'cages', 'C1', 'experiment', { note: 'Prepare sampling' }),
    badgePlan(data, 'locations', 'P1', 'pir', { note: 'No signal' }));
  data = applyPlans(data, badgePlan(data, 'locations', 'P1', 'led', { note: 'Light interrupted' }));
  const ui = renderHarness(data), card = article(ui.host, 'C1'), header = card.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  for (const label of ['DD', 'Geno', 'Exp', 'PIR!', 'LED!']) assert.ok(header.includes(`>${label}</span>`), `${label} is in the header`);
  assert.doesNotMatch(header, /data-sheet-badge-edit|data-sheet-badges=/);
  assert.doesNotMatch(card, /<button[^>]*class="sheet-work-badge/);
  const displays = [...header.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/g)].filter(([, values]) => /sheet-work-display/.test(attributes(values).class || ''));
  assert.equal(displays.length, 4);
  for (const [, values] of displays) {
    const attrs = attributes(values);
    assert.ok(attrs.title); assert.ok(attrs['aria-label']);
  }
  assert.ok(displays.some(([, values]) => attributes(values).title.includes('Experiment')));
  assert.ok(displays.some(([, values]) => attributes(values).title.includes('PIR fault')));
  const headerAttrs = attributes(card.match(/<header\b([^>]*)>/)[1]), cardAttrs = attributes(card.match(/<article\b([^>]*)>/)[1]);
  let captures = 0, prevented = false;
  const headerNode = { dataset: dataAttributes(headerAttrs), setPointerCapture() { captures++; } }, cardNode = { dataset: dataAttributes(cardAttrs) };
  const displayTarget = { dataset: {}, closest(selector) {
    if (selector === '.sheet-work-display') return this;
    if (selector === '.sheet-cage') return cardNode;
    if (selector === '.sheet-cage-drag-region' || selector.split(',').some(part => /^\[[\w-]+\]$/.test(part) && Object.hasOwn(headerAttrs, part.slice(1, -1)))) return headerNode;
    return null;
  } };
  const beforeTap = ui.host.innerHTML;
  await ui.host.onclick({ target: displayTarget, preventDefault() { prevented = true; } });
  for (const [name, x] of [['onpointerdown', 10], ['onpointermove', 40], ['onpointerup', 40]]) ui.host[name]({ target: displayTarget, pointerType: 'mouse', pointerId: 1, button: 0, clientX: x, clientY: 10, preventDefault() { prevented = true; } });
  assert.equal(ui.host.innerHTML, beforeTap, 'Tapping a display badge does not select its cage or open an editor');
  assert.equal(captures, 0, 'A display badge does not transfer pointer capture to its cage header');
  assert.equal(prevented, false); assert.equal(hasCageSheetDrafts(), false);
  await ui.click('data-sheet-badges', undefined, 'C1');
  assert.match(article(ui.host, 'C1'), /<button[^>]*data-sheet-badge-edit=/);
  assert.match(article(ui.host, 'C1'), /Prepare sampling/);
  assert.equal(ui.saved.length, 0); assert.equal(hasCageSheetDrafts(), false);
});
