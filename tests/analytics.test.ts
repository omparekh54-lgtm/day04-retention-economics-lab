import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRows } from '../lib/demo.ts';
import { capacitySelection, trainRetentionModel } from '../lib/analytics.ts';

const assumptions = { grossMarginPct: 70, valueHorizonMonths: 12, interventionCost: 80, assumedSaveRatePct: 25 };

test('model uses a strict time boundary and useful discrimination', () => {
  const result = trainRetentionModel(demoRows(), assumptions);
  assert.ok(result.metric.holdoutRows > 50);
  assert.ok(result.metric.auc !== null);
  assert.ok((result.metric.auc ?? 0) > 0.55);
  assert.ok(result.trainDateMax < result.holdoutDateMin);
});

test('scores are bounded and prioritized', () => {
  const result = trainRetentionModel(demoRows(), assumptions);
  assert.ok(result.scores.every((score) => score.probability >= 0 && score.probability <= 1));
  for (let index = 1; index < result.scores.length; index += 1) assert.ok(result.scores[index - 1].priorityScore >= result.scores[index].priorityScore);
});

test('capacity selection respects economics and capacity', () => {
  const result = trainRetentionModel(demoRows(), assumptions);
  const selected = capacitySelection(result.scores, 12);
  assert.ok(selected.length <= 12);
  assert.ok(selected.every((score) => score.scenarioNetValue > 0));
});

test('current unlabeled snapshots are scored but not used as known outcomes', () => {
  const rows = demoRows();
  const result = trainRetentionModel(rows, assumptions);
  assert.equal(result.scores.length, 140);
  assert.ok(result.scores.every((score) => score.row.churned === null));
  assert.match(result.methodology, /current unlabeled latest snapshots are scored/i);
});

test('known churned latest accounts are excluded when no current unlabeled rows exist', () => {
  const rows = demoRows().map((row) => ({ ...row, churned: row.churned === null ? 0 : row.churned }));
  const target = rows.filter((row) => row.customerId === 'C001').sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).at(-1);
  assert.ok(target);
  if (target) target.churned = 1;
  const result = trainRetentionModel(rows, assumptions);
  assert.ok(!result.scores.some((score) => score.row.customerId === 'C001'));
});
