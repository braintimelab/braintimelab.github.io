import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { planCageSlotMove, validateMouseMoveDrafts } from '../mouse-data/cage-movement.js';
import { applyCageSheetDrafts } from '../mouse-data/cage-sheet.js';
import { createCageBadgeIndex, cageBadgesForItem, planWorkBadgeEdit } from '../mouse-data/cage-badges.js';
import { sourceBadgeTarget, sourceBadgeRows } from '../mouse-data/cage-note-badges.js';
import { cageSheetAnimals } from '../mouse-data/cage-observations.js';
import { projectAnimalSheet } from '../mouse-data/animal-sheet-export.js';
import { normalizeDataset, validateRecord } from '../mouse-data/model.js';

globalThis.crypto ??= webcrypto;
const at = '2026-10-17T04:00:00.000Z';
const observation = (tag = 'Unknown-M001') => ({ schemaVersion: 1, startedDate: '2026-10-01', animals: [{ tag, sourceCell: 'A2', dateOfBirth: '2026-08-01', sex: 'Male', note: '' }] });
function sample({ second = false, registered = false, raw = false } = {}) {
  const source = observation();
  return normalizeDataset({ tables: {
    mice: [],
    cages: registered ? [{ cage_sid: 'C1', cage_tag: 'A1', state: 'Active', location_id: 'P1', room_id: 'R1', rack_id: 'K1' }] : [],
    rooms: [{ room_id: 'R1', name: 'Clean room' }],
    racks: [{ rack_id: 'K1', room_id: 'R1', name: 'Rack A' }],
    locations: [
      { location_id: 'P1', label: 'A1', room_id: 'R1', rack_id: 'K1', source_current: true, source_cage_observation: source, ...(raw ? { source_block_text: 'A1: Genotyping\nB7: Experiment' } : {}) },
      { location_id: 'P2', label: 'A2', room_id: 'R1', rack_id: 'K1', source_current: true, ...(second ? { source_cage_observation: observation('Unknown-M002') } : {}) },
      { location_id: 'P3', label: 'A3', room_id: 'R1', rack_id: 'K1', source_current: true },
    ],
  } });
}
const targetAt = (data, id) => sourceBadgeTarget(id, data.tables.locations.find(row => row.location_id === id).source_cage_observation);
const applyPlans = (data, ...plans) => applyCageSheetDrafts(data, plans.flatMap(plan => plan.changes), { at });
function badgePlan(data, target, kind, status = 'open') { return planWorkBadgeEdit(data, target, { kind, status }, { at }); }
function badgesAt(data, id, noteHints = []) {
  const item = projectAnimalSheet(data, { entityTypes: [], capturedAt: at }).groups.flatMap(group => group.items).find(item => item.position?.location_id === id);
  assert.ok(item, `Position ${id} is projected`);
  return cageBadgesForItem(createCageBadgeIndex(data, { noteHints }), item, cageSheetAnimals(data, item));
}
const sourceChanges = plan => plan.changes.filter(change => change.field === '$source_badges');
const hints = [{ location_id: 'P1', notes: ['Genotyping', 'Experiment', 'PIR!'] }];
const move = (data, options = {}) => planCageSlotMove(data, 'P1', 'P2', { newCageIds: { P1: 'CAGE-NEW' }, ...options });

test('a restricted source move retains header tasks when a later import replaces the original cohort', () => {
  const raw = sample(), source = targetAt(raw, 'P1');
  const data = applyPlans(raw, badgePlan(raw, { type: 'locations', id: 'P1' }, 'pir'));
  const before = structuredClone(data), planned = move(data, { noteHints: hints }), added = sourceChanges(planned);
  assert.equal(added.length, 1, 'Both tasks share one source-card status record');
  assert.equal(added[0].base, null);
  assert.deepEqual(added[0].value.card_badge_status.work_badges.map(row => row.kind), ['genotyping', 'experiment']);
  assert.equal(added[0].cageSlotMove, undefined);
  assert.deepEqual(data, before);
  assert.equal(validateMouseMoveDrafts(data, planned.changes), true);
  const saved = applyPlans(data, planned), imported = structuredClone(saved);
  imported.tables.locations[0].source_cage_observation = observation('Replacement-M099');
  assert.deepEqual(new Set(badgesAt(imported, 'P2').map(row => row.kind)), new Set(['genotyping', 'experiment']));
  assert.ok(badgesAt(imported, 'P1').some(row => row.kind === 'pir'));
  assert.equal(badgesAt(imported, 'P2').some(row => row.kind === 'pir'), false);
  assert.equal(imported.tables.mice.length, 0, 'Source tags never create mouse SIDs');
  assert.equal(sourceBadgeRows(imported, source).length, 2);
  assert.deepEqual(saved.tables.locations[0].source_cage_observation, before.tables.locations[0].source_cage_observation);
  assert.deepEqual(validateRecord('husbandry_events', added[0].value, data, null).errors, []);
});

test('saved Done remains authoritative while another missing header task is retained', () => {
  const raw = sample(), target = targetAt(raw, 'P1'), data = applyPlans(raw, badgePlan(raw, target, 'genotyping', 'done'));
  const beforeEvent = structuredClone(data.tables.husbandry_events[0]), planned = move(data, { noteHints: hints });
  const added = sourceChanges(planned);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].base, beforeEvent);
  assert.deepEqual(added[0].value.card_badge_status.work_badges.map(row => [row.kind, row.status]), [['genotyping', 'done'], ['experiment', 'open']]);
  const saved = applyPlans(data, planned);
  saved.tables.locations[0].source_cage_observation = observation('Replacement-M099');
  assert.deepEqual(badgesAt(saved, 'P2').map(row => row.kind), ['experiment']);
  assert.equal(sourceBadgeRows(saved, target).find(row => row.kind === 'genotyping').status, 'done');
});

test('existing source and ordinary cage work skip duplicate materialization', () => {
  const raw = sample({ registered: true }), target = targetAt(raw, 'P1');
  const data = applyPlans(raw, badgePlan(raw, target, 'genotyping'), badgePlan(raw, { type: 'cages', id: 'C1' }, 'experiment', 'done'));
  const planned = planCageSlotMove(data, 'P1', 'P2', { noteHints: hints });
  assert.deepEqual(sourceChanges(planned), []);
  const saved = applyPlans(data, planned);
  saved.tables.locations[0].source_cage_observation = observation('Replacement-M099');
  assert.deepEqual(badgesAt(saved, 'P2').map(row => row.kind), ['genotyping']);
  assert.equal(saved.tables.husbandry_events.filter(row => row.event_type === 'cage_card_badge_status').length, 1);
});

test('a restricted swap preserves header tasks for both source and destination cohorts', () => {
  const data = sample({ second: true });
  const noteHints = [{ location_id: 'P1', notes: ['Genotyping'] }, { location_id: 'P2', notes: ['Experiment', 'LED!'] }];
  const planned = planCageSlotMove(data, 'P1', 'P2', { newCageIds: { P1: 'CAGE-A', P2: 'CAGE-B' }, noteHints });
  assert.equal(sourceChanges(planned).length, 2);
  const saved = applyPlans(data, planned);
  saved.tables.locations[0].source_cage_observation = observation('Replacement-M099');
  saved.tables.locations[1].source_cage_observation = observation('Replacement-M098');
  assert.deepEqual(badgesAt(saved, 'P2').map(row => row.kind), ['genotyping']);
  assert.deepEqual(badgesAt(saved, 'P1').map(row => row.kind), ['experiment']);
  assert.equal(saved.tables.mice.length, 0);
  assert.equal(saved.tables.husbandry_events.some(row => row.event_type === 'cage_equipment_status'), false);
});

test('raw source tasks and explicit retained task notes do not create additional status events', () => {
  const raw = sample({ raw: true }), planned = move(raw, { noteHints: hints });
  assert.deepEqual(sourceChanges(planned), []);
  const saved = applyPlans(raw, planned);
  assert.deepEqual(saved.tables.cages[0].cage_sheet_card.task_notes, ['Genotyping', 'Experiment']);
  const retained = structuredClone(saved);
  delete retained.tables.locations[0].source_block_text;
  const onward = planCageSlotMove(retained, 'P2', 'P3', { noteHints: hints });
  assert.deepEqual(sourceChanges(onward), []);
  assert.deepEqual(applyPlans(retained, onward).tables.cages[0].cage_sheet_card.task_notes, ['Genotyping', 'Experiment']);
});

test('resolving header cells prevent completed tasks from reappearing after a cage move', () => {
  const data = sample({ raw: true });
  data.tables.locations[0].source_block_text = 'A1: Genotyping\nB1: Genotyping done\nA7: Experiment\nB7: Experiment completed';
  assert.deepEqual(badgesAt(data, 'P1'), []);
  const planned = move(data, { noteHints: hints }), saved = applyPlans(data, planned);
  assert.deepEqual(sourceChanges(planned), []);
  assert.deepEqual(saved.tables.cages[0].cage_sheet_card.task_notes, []);
  assert.deepEqual(badgesAt(saved, 'P2'), []);
  saved.tables.locations[0].source_cage_observation = observation('Replacement-M099');
  assert.deepEqual(badgesAt(saved, 'P2'), []);
  const mixed = sample({ raw: true });
  mixed.tables.locations[0].source_block_text = 'A1: Genotyping\nB1: Genotyping done\nB7: Experiment planned';
  const moved = applyPlans(mixed, move(mixed));
  assert.deepEqual(moved.tables.cages[0].cage_sheet_card.task_notes, ['Experiment planned']);
  assert.deepEqual(badgesAt(moved, 'P2').map(row => row.kind), ['experiment']);
});

test('hints for a replaced original cohort never attach to an older retained card', () => {
  const data = sample({ registered: true }), prior = observation('Prior-M001');
  data.tables.cages[0].location_id = 'P2';
  data.tables.cages[0].cage_tag = 'A2';
  data.tables.cages[0].cage_sheet_card = { schemaVersion: 1, source_location_id: 'P1', observation: prior, unresolved_rows: [{ tag: prior.animals[0].tag, sourceCell: 'A2', reason: 'unlinked' }] };
  const planned = planCageSlotMove(data, 'P2', 'P3', { noteHints: hints });
  assert.deepEqual(sourceChanges(planned), []);
  assert.deepEqual(badgesAt(applyPlans(data, planned), 'P3', hints), []);
});

test('hint materialization keeps the physical proof unchanged and an unchanged save retry is idempotent', () => {
  const data = sample(), plain = move(data), withHints = move(data, { noteHints: hints });
  assert.deepEqual(withHints.changes.filter(change => change.field !== '$source_badges'), plain.changes);
  const saved = applyPlans(data, withHints);
  assert.deepEqual(applyPlans(saved, withHints), saved);
  assert.deepEqual(planCageSlotMove(data, 'P1', 'P1', { noteHints: hints }).changes, []);
});
