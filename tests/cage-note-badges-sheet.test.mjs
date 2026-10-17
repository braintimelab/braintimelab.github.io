import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { applyCageSheetDrafts, renderCageSheet, clearCageSheetDrafts, hasCageSheetDrafts } from '../mouse-data/cage-sheet.js';
import { createCageBadgeIndex, cageBadgesForItem, cageNoteBadgesForItem, planWorkBadgeEdit } from '../mouse-data/cage-badges.js';
import { sourceBadgeTarget, sourceBadgeRows } from '../mouse-data/cage-note-badges.js';
import { planCageSlotMove } from '../mouse-data/cage-movement.js';
import { cageObservations, cageSheetAnimals } from '../mouse-data/cage-observations.js';
import { projectAnimalSheet } from '../mouse-data/animal-sheet-export.js';
import { normalizeDataset, validateRecord } from '../mouse-data/model.js';

globalThis.crypto ??= webcrypto;
const at = '2026-10-17T04:00:00.000Z';
const capturedAt = at;
function sample({ header = 'Genotyping', footer = 'Experiment planned', rowNote = '', linked = false } = {}) {
  return normalizeDataset({ tables: {
    mice: linked ? [{ mouse_sid: 'M1', physical_tag: 'P-M001', sex: 'Male', state: 'Stock', date_of_birth: '2026-01-01', cage_sid: 'C1', cage_tag: 'A1' }] : [],
    cages: linked ? [{ cage_sid: 'C1', cage_tag: 'A1', state: 'Active', location_id: 'P1', room_id: 'R1', rack_id: 'K1' }] : [],
    rooms: [{ room_id: 'R1', name: 'Clean room' }],
    racks: [{ rack_id: 'K1', room_id: 'R1', name: 'Rack A' }],
    locations: [
      { location_id: 'P1', label: 'A1', room_id: 'R1', rack_id: 'K1', row: 1, column: 1, source_current: true,
        source_cell: 'A1', source_block_range: 'A1:F7', source_captured_at: capturedAt,
        source_block_text: [`A1: ${header}`, 'A2: P-M001', `B2: ${rowNote}`, 'C2: 2026-01-01', 'D2: 0', 'E2: 1', 'A7: 2026-02-01', `B7: ${footer}`].join('\n') },
      { location_id: 'P2', label: 'A2', room_id: 'R1', rack_id: 'K1', row: 1, column: 2, source_current: true },
    ],
  } });
}
function itemAt(data, positionId = 'P1') {
  const item = projectAnimalSheet(data, { entityTypes: [], capturedAt }).groups.flatMap(group => group.items).find(item => item.position?.location_id === positionId);
  assert.ok(item, `Position ${positionId} is projected`);
  return item;
}
function notesAt(data, positionId = 'P1', options) {
  const item = itemAt(data, positionId), rows = cageSheetAnimals(data, item);
  return cageNoteBadgesForItem(createCageBadgeIndex(data), item, rows, options);
}
function badgesAt(data, positionId = 'P1') {
  const item = itemAt(data, positionId);
  return cageBadgesForItem(createCageBadgeIndex(data), item, cageSheetAnimals(data, item));
}
const sourceTarget = (data, animal = null) => sourceBadgeTarget('P1', cageObservations(data.tables.locations[0]), animal);
const plan = (data, target, kind, status = 'done', note = '') => planWorkBadgeEdit(data, target, { kind, status, note }, { at });
const applyPlans = (data, ...plans) => applyCageSheetDrafts(data, plans.flatMap(plan => plan.changes), { at });

// Self-contained host for the live renderer's delegated badge and Save handlers.
const decode = value => String(value ?? '').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const attributes = source => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const dataAttributes = attrs => Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
function sheetHost() {
  let html = '', nodes = new Map();
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, { disabled: false, textContent: '', querySelector() { return { textContent: '' }; } }]));
    },
    querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
    querySelectorAll() { return []; },
  };
}
function articleAt(host, positionId) {
  const match = [...host.innerHTML.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)].find(([, source]) => attributes(source)['data-sheet-slot'] === positionId);
  assert.ok(match, `Position ${positionId} is rendered`);
  return match[0];
}
function renderedButton(host, attr, { positionId, text } = {}) {
  const html = positionId ? articleAt(host, positionId) : host.innerHTML;
  const match = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(([, source, body]) => {
    const attrs = attributes(source), has = Object.hasOwn(attrs, attr) || new RegExp(`\\b${attr}(?=[\\s>]|$)`).test(source);
    return has && (text === undefined || decode(body).includes(text));
  });
  assert.ok(match, `Rendered ${attr}${text ? ' ' + text : ''}`);
  const attrs = attributes(match[1]), booleanAttrs = new Set([...match[1].matchAll(/\b(data-[\w-]+)(?=\s|$)/g)].map(match => match[1]));
  return {
    dataset: dataAttributes(attrs), hasAttribute: name => Object.hasOwn(attrs, name) || booleanAttrs.has(name),
    closest(selector) { return selector.split(',').some(part => part === 'button' || /^\[[\w-]+\]$/.test(part) && this.hasAttribute(part.slice(1, -1))) ? this : null; },
  };
}
function renderHarness(data, overrides = {}) {
  clearCageSheetDrafts();
  const host = sheetHost(), saved = [];
  renderCageSheet(host, data, { context: 'source-note-fixture', currentContext: () => 'source-note-fixture', canEdit: () => true, loadFresh: async () => data, save: async (next, options) => saved.push({ next, options }), ...overrides });
  return { host, saved,
    input: (dataset, value) => host.oninput({ target: { dataset, value, classList: { toggle() {} } } }),
    click: (attr, options) => host.onclick({ target: renderedButton(host, attr, options), preventDefault() {} }),
    sync: () => host.querySelector('#cage-sheet-sync').onclick() };
}
async function stageInferredDone(ui, label = 'Genotyping', positionId = 'P1') {
  await ui.click('data-sheet-badge-edit', { positionId, text: label });
  ui.input({ sheetBadgeField: 'status' }, 'done');
  await ui.click('data-sheet-badge-apply');
}

test('raw Animal Sheet header, footer and row phrases yield source badges without writing imported observations', () => {
  const data = sample({ rowNote: 'Genotyping pending' }), before = structuredClone(data), badges = notesAt(data);
  assert.deepEqual(new Set(badges.map(badge => badge.kind)), new Set(['genotyping', 'experiment']));
  assert.ok(badges.every(badge => badge.inferred && badge.type === 'source_cards'));
  assert.equal(badges.filter(badge => badge.kind === 'genotyping').length, 2, 'Header card task and distinct row task retain their scopes');
  assert.deepEqual(data, before);
  const ui = renderHarness(data);
  assert.match(articleAt(ui.host, 'P1'), />Genotyping ×2<\/button>/);
  assert.equal(hasCageSheetDrafts(), false);
});

test('Done on an unlinked inferred row saves a generic source event through the existing Save button', async () => {
  const data = sample({ header: '', footer: '', rowNote: 'Genotyping pending' }), before = structuredClone(data), ui = renderHarness(data);
  await stageInferredDone(ui);
  assert.equal(hasCageSheetDrafts(), true);
  assert.equal(ui.saved.length, 0);
  assert.deepEqual(data, before);
  await ui.sync();
  assert.equal(ui.saved.length, 1);
  const saved = ui.saved[0].next, event = saved.tables.husbandry_events.find(row => row.event_type === 'cage_card_badge_status');
  assert.ok(event);
  assert.equal(event.card_badge_status.work_badges[0].status, 'done');
  assert.equal(event.location_id, 'P1');
  assert.equal(event.mouse_sid, undefined);
  assert.equal(saved.tables.mice.length, 0);
  assert.equal(saved.tables.cages.length, 0);
  assert.equal(saved.tables.locations[0].source_block_text, before.tables.locations[0].source_block_text);
  assert.doesNotMatch(articleAt(ui.host, 'P1'), />Genotyping<\/button>/);
  assert.ok(ui.saved[0].options.readDependencies.some(row => row.type === 'locations' && row.id === 'P1'));
});

test('reopening a saved card badge passes the main provenance validator and preserves source fields', () => {
  const data = sample({ header: 'Genotyping', footer: '' }), target = sourceTarget(data);
  const saved = applyPlans(data, plan(data, target, 'genotyping'));
  const event = saved.tables.husbandry_events.find(row => row.event_id === target.id);
  assert.equal(event.card_badge_status.work_badges[0].status, 'done');
  assert.equal(event.record_origin, 'app_created');
  assert.equal(Object.hasOwn(event, 'source_badge_status'), false);
  // Existing evidence metadata must survive an ordinary status edit as well.
  event.source_reference = { file: 'Animal Sheet fixture', cell: 'A1' };
  const before = structuredClone(saved);
  const reopened = applyPlans(saved, plan(saved, target, 'genotyping', 'open', 'New sample requested'));
  const updated = reopened.tables.husbandry_events.find(row => row.event_id === target.id);
  assert.equal(updated.card_badge_status.work_badges[0].status, 'open');
  assert.deepEqual(validateRecord('husbandry_events', updated, saved, target.id).errors, []);
  assert.equal(updated.record_origin, event.record_origin);
  assert.deepEqual(updated.source_reference, event.source_reference);
  assert.deepEqual(reopened.tables.locations, before.tables.locations);
  assert.deepEqual(saved, before);
});

test('a saved Done decision survives daily recapture, note edits and nonidentity source corrections', () => {
  const data = sample({ header: '', footer: '', rowNote: 'Genotyping pending' }), observation = cageObservations(data.tables.locations[0]);
  const target = sourceTarget(data, observation.animals[0]), saved = applyPlans(data, plan(data, target, 'genotyping'));
  const refreshed = structuredClone(saved), position = refreshed.tables.locations[0];
  position.source_captured_at = '2026-10-18T04:00:00.000Z';
  position.source_block_text = position.source_block_text.replace('Genotyping pending', 'Genotyping pending, sample requested').replace('D2: 0', 'D2: 2');
  assert.equal(sourceTarget(refreshed, cageObservations(position).animals[0]).id, target.id);
  assert.deepEqual(notesAt(refreshed), []);
  assert.equal(notesAt(refreshed, 'P1', { includeDone: true })[0].status, 'done');
  assert.equal(sourceBadgeRows(refreshed, target)[0].status, 'done');
});

test('a different source cohort gets a fresh inferred task instead of inheriting Done', () => {
  const data = sample({ header: 'Genotyping', footer: '' }), target = sourceTarget(data), saved = applyPlans(data, plan(data, target, 'genotyping'));
  assert.deepEqual(notesAt(saved), []);
  for (const [from, to] of [['P-M001', 'P-M002'], ['C2: 2026-01-01', 'C2: 2026-01-02'], ['A7: 2026-02-01', 'A7: 2026-03-01']]) {
    const changed = structuredClone(saved);
    changed.tables.locations[0].source_block_text = changed.tables.locations[0].source_block_text.replace(from, to);
    const badges = notesAt(changed);
    assert.equal(badges.length, 1);
    assert.equal(badges[0].kind, 'genotyping');
    assert.equal(badges[0].inferred, true);
    assert.notEqual(badges[0].id, target.id);
  }
});

test('whole-cage movement retains source task notes and Done decisions while a PIR fault stays at its position', () => {
  const data = sample({ header: 'Genotyping; PIR bad' }), target = sourceTarget(data);
  const saved = applyPlans(data, plan(data, target, 'genotyping'), plan(data, { type: 'locations', id: 'P1' }, 'pir', 'open', 'Replace sensor'));
  const move = planCageSlotMove(saved, 'P1', 'P2', { newCageIds: { P1: 'CAGE-NEW' } }), moved = applyPlans(saved, move);
  const cage = moved.tables.cages.find(row => row.cage_sid === 'CAGE-NEW');
  assert.equal(cage.location_id, 'P2');
  assert.ok(cage.cage_sheet_card.task_notes.some(note => note.includes('Genotyping')));
  assert.ok(cage.cage_sheet_card.task_notes.some(note => note.includes('Experiment')));
  assert.equal(notesAt(moved, 'P2').some(badge => badge.kind === 'genotyping'), false);
  assert.ok(notesAt(moved, 'P2').some(badge => badge.kind === 'experiment'));
  assert.ok(badgesAt(moved, 'P1').some(badge => badge.kind === 'pir'));
  assert.equal(badgesAt(moved, 'P2').some(badge => badge.kind === 'pir'), false);
  assert.equal(sourceBadgeRows(moved, target)[0].status, 'done');
  assert.equal(moved.tables.locations[0].source_block_text, data.tables.locations[0].source_block_text);
  const reopened = applyPlans(moved, plan(moved, target, 'genotyping', 'open'));
  assert.ok(notesAt(reopened, 'P2').some(badge => badge.kind === 'genotyping' && !badge.inferred));
});

test('explicit mouse and cage work status wins over inferred source notes of the same kind', () => {
  const data = sample({ linked: true, rowNote: 'Genotyping pending' });
  const done = applyPlans(data, plan(data, { type: 'mice', id: 'M1' }, 'genotyping'), plan(data, { type: 'cages', id: 'C1' }, 'genotyping'));
  const saved = applyPlans(done, plan(done, { type: 'cages', id: 'C1' }, 'experiment', 'in_progress', 'Explicit schedule'));
  const badges = badgesAt(saved);
  assert.equal(badges.some(badge => badge.kind === 'genotyping'), false);
  assert.equal(badges.filter(badge => badge.kind === 'experiment').length, 1);
  assert.equal(badges.find(badge => badge.kind === 'experiment').note, 'Explicit schedule');
  assert.equal(badges.find(badge => badge.kind === 'experiment').inferred, undefined);
});

test('historical mouse comments do not lend tasks to a current cage or historical rendering', () => {
  const data = sample({ linked: true, header: '', footer: '' });
  data.tables.mice[0].comment = 'Old genotyping and experiment notes';
  data.tables.mice.push({ ...data.tables.mice[0], mouse_sid: 'ENDED', physical_tag: 'P-M099', state: 'Ended', comment: 'Genotyping pending; experiment planned', source_historical: true });
  assert.deepEqual(notesAt(data), []);
  const historical = structuredClone(data);
  historical.history_projection = { read_only: true };
  assert.deepEqual(notesAt(historical), []);
  const ui = renderHarness(historical, { readOnly: true, selectedDate: '2026-10-01' });
  assert.doesNotMatch(ui.host.innerHTML, /class="sheet-work-badge /);
});

test('completed, negated and conditional source statements do not create active badges', () => {
  for (const phrase of ['Genotyping done', 'No genotyping', 'Genotype results received', 'Experiment completed', 'No experiment planned', 'Experiment cancelled', 'PIR fixed', 'LED working normally', 'If genotyping is needed', '已完成基因分型', '取消實驗']) {
    const data = sample({ header: phrase, footer: '', rowNote: phrase });
    assert.deepEqual(notesAt(data), [], phrase);
  }
});

test('a fresh source identity conflict blocks every accompanying sheet edit and preserves the pending draft', async () => {
  const data = sample({ header: '', footer: '', rowNote: 'Genotyping pending' }), fresh = structuredClone(data);
  fresh.tables.locations[0].source_block_text = fresh.tables.locations[0].source_block_text.replace('P-M001', 'P-M002');
  const ui = renderHarness(data, { loadFresh: async () => fresh });
  await stageInferredDone(ui);
  ui.input({ sheetType: 'locations', sheetId: 'P2', sheetField: 'notes' }, 'Must stay unsaved');
  const before = structuredClone(fresh);
  await ui.sync();
  assert.equal(ui.saved.length, 0);
  assert.equal(hasCageSheetDrafts(), true);
  assert.deepEqual(fresh, before);
  assert.match(ui.host.innerHTML, /source card identity changed|no longer current/i);
  clearCageSheetDrafts();
});


test('restricted source projections infer canonical hints and preserve Done without exposing raw blocks', () => {
  const data=sample({header:'Genotyping',footer:'PIR not good'}), position=data.tables.locations[0];
  position.source_cage_observation=cageObservations(position);
  delete position.source_block_text;
  const noteHints=[{location_id:'P1',notes:['Genotyping','PIR not good']}],item=itemAt(data);
  const entries=cageBadgesForItem(createCageBadgeIndex(data,{noteHints}),item,cageSheetAnimals(data,item));
  assert.deepEqual(entries.map(row=>row.kind).sort(),['genotyping','pir']);
  const target=sourceBadgeTarget('P1',position.source_cage_observation),next=applyPlans(data,plan(data,target,'genotyping','done'));
  const nextItem=itemAt(next);
  assert.deepEqual(cageBadgesForItem(createCageBadgeIndex(next,{noteHints}),nextItem,cageSheetAnimals(next,nextItem)).map(row=>row.kind),['pir']);
  assert.equal(next.tables.locations[0].source_block_text,undefined);
  const moved=applyCageSheetDrafts(data,planCageSlotMove(data,'P1','P2',{newCageIds:{P1:'NEW1',P2:'NEW2'}}).changes,{at});
  const movedItem=itemAt(moved,'P2');
  const movedKinds=cageBadgesForItem(createCageBadgeIndex(moved,{noteHints}),movedItem,cageSheetAnimals(moved,movedItem)).map(row=>row.kind);
  assert.deepEqual(movedKinds,['genotyping']);
});

test('raw source is authoritative over stale canonical hints', () => {
  const data=sample({header:'Genotyping done',footer:'PIR fixed'}),item=itemAt(data);
  const index=createCageBadgeIndex(data,{noteHints:[{location_id:'P1',notes:['Genotyping','PIR not good']}]});
  assert.deepEqual(cageBadgesForItem(index,item,cageSheetAnimals(data,item)),[]);
});

test('member hints load asynchronously, and a late result cannot repaint a different account', async () => {
  const data=sample({header:'Genotyping',footer:''}),position=data.tables.locations[0];
  position.source_cage_observation=cageObservations(position);delete position.source_block_text;
  let resolve,context='source-note-fixture';
  const ui=renderHarness(data,{loadNoteHints:()=>new Promise(done=>{resolve=done;}),currentContext:()=>context});
  assert.doesNotMatch(articleAt(ui.host,'P1'),/>Genotyping<\/button>/);
  resolve([{location_id:'P1',notes:['Genotyping']}]);await new Promise(setImmediate);
  assert.match(articleAt(ui.host,'P1'),/>Genotyping<\/button>/);
  const other=renderHarness(data,{loadNoteHints:()=>new Promise(done=>{resolve=done;}),currentContext:()=>context});
  context='different-account';const before=other.host.innerHTML;
  resolve([{location_id:'P1',notes:['Genotyping']}]);await new Promise(setImmediate);
  assert.equal(other.host.innerHTML,before);
});
