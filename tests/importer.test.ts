import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMapping, validateRows } from '../lib/importer.ts';
import type { ParsedTable } from '../lib/types.ts';

const columns = ['customer_id','snapshot_date','renewal_date','monthly_revenue','plan_tier','usage_30d','usage_prev_30d','tickets_30d','late_payments_90d','tenure_months','active_days_30d','churned'];
const mapping = inferMapping(columns);

function table(row: Record<string, unknown>): ParsedTable {
  return { fileName: 'test.csv', columns, rows: [row] };
}

const base = {
  customer_id: 'C001',
  snapshot_date: '31/07/2026',
  renewal_date: '15/09/2026',
  monthly_revenue: 420,
  plan_tier: 'Pro',
  usage_30d: 38,
  usage_prev_30d: 48,
  tickets_30d: 3,
  late_payments_90d: 1,
  tenure_months: 26,
  active_days_30d: 12,
  churned: '',
};

test('blank churn label is accepted as a current scoring row', () => {
  const report = validateRows(table(base), mapping);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.accepted[0].churned, null);
  assert.equal(report.accepted[0].snapshotDate, '2026-07-31');
  assert.equal(report.accepted[0].renewalDate, '2026-09-15');
});

test('invalid supplied renewal date is rejected instead of silently becoming unknown', () => {
  const report = validateRows(table({ ...base, renewal_date: '31/02/2026' }), mapping);
  assert.equal(report.accepted.length, 0);
  assert.match(report.rejected[0].reason, /invalid renewal date/);
});

test('invalid churn labels are rejected while 0 and 1 remain valid', () => {
  assert.equal(validateRows(table({ ...base, churned: 0 }), mapping).accepted.length, 1);
  assert.equal(validateRows(table({ ...base, churned: 1 }), mapping).accepted.length, 1);
  assert.match(validateRows(table({ ...base, churned: 2 }), mapping).rejected[0].reason, /churned must be 0, 1, or blank/);
});
