import * as XLSX from 'xlsx';
import type { CustomerSnapshot, Mapping, ParsedTable, ValidationReport } from './types.ts';

export const FIELD_SPECS = [
  ['customerId', 'Customer ID', true],
  ['snapshotDate', 'Snapshot date', true],
  ['renewalDate', 'Renewal date', false],
  ['monthlyRevenue', 'Monthly revenue', true],
  ['planTier', 'Plan tier', false],
  ['usage30d', 'Usage 30d', true],
  ['usagePrev30d', 'Usage previous 30d', true],
  ['tickets30d', 'Tickets 30d', true],
  ['latePayments90d', 'Late payments 90d', true],
  ['tenureMonths', 'Tenure months', true],
  ['activeDays30d', 'Active days 30d', true],
  ['churned', 'Churned label (0/1; blank = current)', true],
] as const;

const aliases: Record<keyof Mapping, string[]> = {
  customerId: ['customer_id', 'customer', 'account_id', 'client_id', 'id'],
  snapshotDate: ['snapshot_date', 'as_of_date', 'date', 'observation_date'],
  renewalDate: ['renewal_date', 'contract_end', 'renewal'],
  monthlyRevenue: ['monthly_revenue', 'mrr', 'revenue', 'arr_monthly', 'monthly_value'],
  planTier: ['plan_tier', 'plan', 'tier', 'segment'],
  usage30d: ['usage_30d', 'usage30d', 'events_30d', 'logins_30d'],
  usagePrev30d: ['usage_prev_30d', 'previous_usage_30d', 'usage_prior_30d', 'events_prev_30d'],
  tickets30d: ['tickets_30d', 'support_tickets_30d', 'tickets'],
  latePayments90d: ['late_payments_90d', 'late_payments', 'payment_delays_90d'],
  tenureMonths: ['tenure_months', 'tenure', 'months_active'],
  activeDays30d: ['active_days_30d', 'active_days', 'days_active_30d'],
  churned: ['churned', 'churn', 'is_churned', 'target'],
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function inferMapping(columns: string[]): Mapping {
  const out = {} as Mapping;
  for (const key of Object.keys(aliases) as Array<keyof Mapping>) out[key] = columns.find((column) => aliases[key].includes(normalize(column))) ?? '';
  return out;
}

export async function parseFile(file: File): Promise<ParsedTable> {
  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  if (!rows.length) throw new Error('No data rows found.');
  return { fileName: file.name, columns: Object.keys(rows[0]), rows };
}

function num(value: unknown) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  return Number(String(value).replace(/[$,₹€£]/g, ''));
}

function validUtcDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return validUtcDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const dayFirst = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dayFirst) return validUtcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

export function validateRows(parsed: ParsedTable, mapping: Mapping): ValidationReport {
  const required = (FIELD_SPECS.filter((field) => field[2]) as readonly (readonly [keyof Mapping, string, boolean])[]).map((field) => field[0]);
  const missing = required.filter((key) => !mapping[key]);
  if (missing.length) throw new Error(`Map required fields: ${missing.join(', ')}`);

  const accepted: CustomerSnapshot[] = [];
  const rejected: Array<{ row: number; reason: string }> = [];

  parsed.rows.forEach((sourceRow, index) => {
    const date = iso(sourceRow[mapping.snapshotDate]);
    const rawRenewal = mapping.renewalDate ? sourceRow[mapping.renewalDate] : null;
    const renewal = mapping.renewalDate ? iso(rawRenewal) : null;
    const rawChurn = sourceRow[mapping.churned];
    const churn = isBlank(rawChurn) ? null : num(rawChurn);
    const values = {
      rev: num(sourceRow[mapping.monthlyRevenue]),
      usage: num(sourceRow[mapping.usage30d]),
      prev: num(sourceRow[mapping.usagePrev30d]),
      tickets: num(sourceRow[mapping.tickets30d]),
      late: num(sourceRow[mapping.latePayments90d]),
      tenure: num(sourceRow[mapping.tenureMonths]),
      active: num(sourceRow[mapping.activeDays30d]),
    };
    const reasons: string[] = [];

    if (!String(sourceRow[mapping.customerId] ?? '').trim()) reasons.push('missing customer id');
    if (!date) reasons.push('invalid snapshot date');
    if (mapping.renewalDate && !isBlank(rawRenewal) && !renewal) reasons.push('invalid renewal date');
    if (churn !== null && ![0, 1].includes(churn)) reasons.push('churned must be 0, 1, or blank for a current scoring row');
    for (const [key, value] of Object.entries(values)) if (!Number.isFinite(value) || value < 0) reasons.push(`invalid ${key}`);
    if (values.active > 31) reasons.push('active days > 31');

    if (reasons.length) {
      rejected.push({ row: index + 2, reason: reasons.join('; ') });
      return;
    }

    accepted.push({
      customerId: String(sourceRow[mapping.customerId]).trim(),
      snapshotDate: date!,
      renewalDate: renewal,
      monthlyRevenue: values.rev,
      planTier: mapping.planTier ? String(sourceRow[mapping.planTier] ?? 'Unspecified') : 'Unspecified',
      usage30d: values.usage,
      usagePrev30d: values.prev,
      tickets30d: values.tickets,
      latePayments90d: values.late,
      tenureMonths: values.tenure,
      activeDays30d: values.active,
      churned: churn,
    });
  });

  const warnings: string[] = [];
  const labelled = accepted.filter((row) => row.churned === 0 || row.churned === 1).length;
  const current = accepted.filter((row) => row.churned === null).length;
  if (labelled < 100) warnings.push('Small labelled histories can produce unstable probability estimates; interpret holdout metrics cautiously.');
  if (current > 0) warnings.push(`${current.toLocaleString()} unlabeled current snapshots will be scored but will not be used to train or evaluate the model.`);
  const counts = new Map<string, number>();
  accepted.forEach((row) => counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1));
  if (accepted.length && [...counts.values()].every((value) => value === 1)) warnings.push('Only one snapshot per customer: risk trajectory is unavailable.');

  return { accepted, rejected, warnings };
}

export function templateCsv() {
  return 'customer_id,snapshot_date,renewal_date,monthly_revenue,plan_tier,usage_30d,usage_prev_30d,tickets_30d,late_payments_90d,tenure_months,active_days_30d,churned\nC001,2026-05-31,2026-09-15,420,Pro,61,70,1,0,24,18,0\nC001,2026-06-30,2026-09-15,420,Pro,48,61,2,0,25,15,0\nC001,2026-07-31,2026-09-15,420,Pro,38,48,3,1,26,12,\n';
}
