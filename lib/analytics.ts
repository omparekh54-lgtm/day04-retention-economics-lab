import type { CustomerScore, CustomerSnapshot, DriftSignal, ModelMetric, ModelResult, RiskReason } from './types.ts';

const FEATURES = [
  ['usageChange', 'Usage change'],
  ['tickets30d', 'Support tickets'],
  ['latePayments90d', 'Late payments'],
  ['tenureMonths', 'Tenure'],
  ['activeDays30d', 'Active days'],
  ['logRevenue', 'Revenue level'],
] as const;

export interface ScenarioAssumptions {
  grossMarginPct: number;
  valueHorizonMonths: number;
  interventionCost: number;
  assumedSaveRatePct: number;
}

interface PreparedRow {
  row: CustomerSnapshot;
  y: number;
  x: number[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(x: number) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function featureVector(row: CustomerSnapshot): number[] {
  const usageChange = row.usagePrev30d > 0 ? clamp(row.usage30d / row.usagePrev30d - 1, -1.5, 2) : 0;
  return [usageChange, row.tickets30d, row.latePayments90d, row.tenureMonths, row.activeDays30d, Math.log1p(row.monthlyRevenue)];
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

function standardDeviation(values: number[], avg: number) {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(values.length - 1, 1)) || 1;
}

function standardizers(rows: PreparedRow[]) {
  return FEATURES.map((_, index) => {
    const values = rows.map((row) => row.x[index]);
    const avg = mean(values);
    return { mean: avg, sd: standardDeviation(values, avg) };
  });
}

function transform(x: number[], stats: Array<{ mean: number; sd: number }>) {
  return x.map((value, index) => (value - stats[index].mean) / stats[index].sd);
}

function fitLogistic(train: PreparedRow[], stats: Array<{ mean: number; sd: number }>) {
  const n = train.length;
  const p = FEATURES.length;
  const weights = new Array(p + 1).fill(0);
  const rate = 0.08;
  const l2 = 0.08;

  for (let epoch = 0; epoch < 700; epoch += 1) {
    const grad = new Array(p + 1).fill(0);
    for (const item of train) {
      const x = transform(item.x, stats);
      let z = weights[0];
      for (let j = 0; j < p; j += 1) z += weights[j + 1] * x[j];
      const error = sigmoid(z) - item.y;
      grad[0] += error;
      for (let j = 0; j < p; j += 1) grad[j + 1] += error * x[j];
    }
    weights[0] -= (rate * grad[0]) / n;
    for (let j = 1; j <= p; j += 1) weights[j] -= rate * (grad[j] / n + (l2 * weights[j]) / n);
  }
  return weights;
}

function predict(xRaw: number[], weights: number[], stats: Array<{ mean: number; sd: number }>) {
  const x = transform(xRaw, stats);
  let z = weights[0];
  for (let j = 0; j < x.length; j += 1) z += weights[j + 1] * x[j];
  return sigmoid(z);
}

function aucScore(labels: number[], probs: number[]): number | null {
  const positive = probs.filter((_, index) => labels[index] === 1);
  const negative = probs.filter((_, index) => labels[index] === 0);
  if (!positive.length || !negative.length) return null;
  let wins = 0;
  for (const p of positive) {
    for (const n of negative) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / (positive.length * negative.length);
}

function metrics(labels: number[], probs: number[], prior: number): ModelMetric {
  const predicted = probs.map((probability) => (probability >= 0.5 ? 1 : 0));
  const majority = prior >= 0.5 ? 1 : 0;
  return {
    auc: aucScore(labels, probs),
    brier: mean(probs.map((probability, index) => (probability - labels[index]) ** 2)),
    accuracy: mean(predicted.map((value, index) => (value === labels[index] ? 1 : 0))),
    baselineAccuracy: mean(labels.map((label) => (label === majority ? 1 : 0))),
    positiveRate: mean(labels),
    holdoutRows: labels.length,
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function daysBetween(a: string, b: string | null) {
  const d1 = parseDate(a);
  const d2 = parseDate(b);
  if (!d1 || !d2) return null;
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
}

function reasonsFor(row: CustomerSnapshot, weights: number[], stats: Array<{ mean: number; sd: number }>): RiskReason[] {
  const x = transform(featureVector(row), stats);
  return FEATURES.map((feature, index) => ({
    feature: feature[0],
    label: feature[1],
    contribution: weights[index + 1] * x[index],
    direction: (weights[index + 1] * x[index] >= 0 ? 'risk' : 'protective') as 'risk' | 'protective',
  }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3);
}

function splitPreparedByTime(labelled: PreparedRow[]) {
  const dates = Array.from(new Set(labelled.map((row) => row.row.snapshotDate))).sort();
  if (dates.length >= 2) {
    const cutIndex = Math.min(dates.length - 1, Math.max(1, Math.floor(dates.length * 0.8)));
    const holdoutStart = dates[cutIndex];
    return {
      train: labelled.filter((row) => row.row.snapshotDate < holdoutStart),
      holdout: labelled.filter((row) => row.row.snapshotDate >= holdoutStart),
      mode: 'date-boundary' as const,
    };
  }
  const split = Math.max(30, Math.floor(labelled.length * 0.8));
  return { train: labelled.slice(0, split), holdout: labelled.slice(split), mode: 'row-fallback' as const };
}

export function trainRetentionModel(rows: CustomerSnapshot[], assumptions: ScenarioAssumptions): ModelResult {
  const labelled = rows
    .filter((row): row is CustomerSnapshot & { churned: number } => row.churned === 0 || row.churned === 1)
    .map((row) => ({ row, y: row.churned as number, x: featureVector(row) }))
    .sort((a, b) => a.row.snapshotDate.localeCompare(b.row.snapshotDate));

  if (labelled.length < 50) throw new Error('At least 50 labelled historical rows are required to train a stable demo-grade model.');
  if (new Set(labelled.map((row) => row.y)).size < 2) throw new Error('Churn labels need both 0 and 1 examples.');

  const { train, holdout, mode } = splitPreparedByTime(labelled);
  if (new Set(train.map((row) => row.y)).size < 2) throw new Error('The training period needs both churned and retained examples.');
  if (!holdout.some((row) => row.y === 1) || !holdout.some((row) => row.y === 0)) throw new Error('Latest holdout period must contain both churned and retained examples.');

  const stats = standardizers(train);
  const weights = fitLogistic(train, stats);
  const prior = mean(train.map((row) => row.y));
  const holdoutProbabilities = holdout.map((row) => predict(row.x, weights, stats));
  const metric = metrics(holdout.map((row) => row.y), holdoutProbabilities, prior);

  const latestByCustomer = new Map<string, CustomerSnapshot>();
  for (const row of rows) {
    const previous = latestByCustomer.get(row.customerId);
    if (!previous || row.snapshotDate > previous.snapshotDate) latestByCustomer.set(row.customerId, row);
  }
  const latest = [...latestByCustomer.values()];
  const currentUnlabelled = latest.filter((row) => row.churned === null);
  const scoringRows = currentUnlabelled.length ? currentUnlabelled : latest.filter((row) => row.churned !== 1);
  if (!scoringRows.length) throw new Error('No current customers are available to score. Add unlabeled current snapshots or retained latest snapshots.');

  const scores: CustomerScore[] = scoringRows
    .map((row) => {
      const probability = predict(featureVector(row), weights, stats);
      const days = daysBetween(row.snapshotDate, row.renewalDate);
      const urgency = days === null ? 1 : 1 + clamp((90 - days) / 90, 0, 1.5);
      const contributionValue = row.monthlyRevenue * (assumptions.grossMarginPct / 100) * assumptions.valueHorizonMonths;
      const scenarioNetValue = probability * contributionValue * (assumptions.assumedSaveRatePct / 100) - assumptions.interventionCost;
      return {
        row,
        probability,
        reasons: reasonsFor(row, weights, stats),
        contributionValue,
        daysToRenewal: days,
        urgency,
        scenarioNetValue,
        priorityScore: Math.max(0, scenarioNetValue) * urgency,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const scoringPrepared = scoringRows.map((row) => ({ row, y: 0, x: featureVector(row) }));
  const drift: DriftSignal[] = FEATURES.map((feature, index) => {
    const shift = (mean(scoringPrepared.map((row) => row.x[index])) - stats[index].mean) / stats[index].sd;
    const absolute = Math.abs(shift);
    return {
      feature: feature[1],
      standardizedShift: shift,
      severity: (absolute >= 1 ? 'high' : absolute >= 0.5 ? 'medium' : 'low') as DriftSignal['severity'],
    };
  }).sort((a, b) => Math.abs(b.standardizedShift) - Math.abs(a.standardizedShift));

  const scoringDescription = currentUnlabelled.length
    ? `${currentUnlabelled.length} current unlabeled latest snapshots are scored; known churn outcomes are never placed in the action queue.`
    : 'No unlabeled current snapshots were supplied, so latest retained snapshots are scored as a backward-compatible fallback; known churned accounts are excluded.';

  return {
    metric,
    scores,
    drift,
    featureWeights: FEATURES.map((feature, index) => ({ feature: feature[0], label: feature[1], weight: weights[index + 1] })).sort(
      (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    ),
    trainDateMax: train.at(-1)?.row.snapshotDate ?? '',
    holdoutDateMin: holdout[0]?.row.snapshotDate ?? '',
    methodology: `Regularized logistic regression with ${
      mode === 'date-boundary' ? 'a whole-date temporal holdout' : 'an 80/20 row fallback because only one labelled snapshot date was available'
    }. ${scoringDescription} Probabilities are observational predictions; retention intervention value uses user-controlled scenario assumptions and is not a causal uplift estimate.`,
  };
}

export function riskTrajectory(rows: CustomerSnapshot[], customerId: string): Array<{ date: string; probability: number }> {
  const labelled = rows
    .filter((row) => row.churned === 0 || row.churned === 1)
    .map((row) => ({ row, y: row.churned as number, x: featureVector(row) }))
    .sort((a, b) => a.row.snapshotDate.localeCompare(b.row.snapshotDate));
  const { train } = splitPreparedByTime(labelled);
  const stats = standardizers(train);
  const weights = fitLogistic(train, stats);
  return rows
    .filter((row) => row.customerId === customerId)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .map((row) => ({ date: row.snapshotDate, probability: predict(featureVector(row), weights, stats) }));
}

export function capacitySelection(scores: CustomerScore[], capacity: number) {
  return scores.filter((score) => score.scenarioNetValue > 0).slice(0, Math.max(0, capacity));
}

export function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
