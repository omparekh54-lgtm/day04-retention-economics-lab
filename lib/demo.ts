import type { CustomerSnapshot } from './types.ts';

function rand(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export function demoRows(): CustomerSnapshot[] {
  const random = rand(40423);
  const rows: CustomerSnapshot[] = [];
  const tiers = ['Starter', 'Growth', 'Enterprise'];

  for (let customer = 1; customer <= 140; customer += 1) {
    const tier = tiers[Math.floor(random() * tiers.length)];
    const baseRevenue = tier === 'Enterprise' ? 1200 + random() * 1600 : tier === 'Growth' ? 350 + random() * 650 : 80 + random() * 220;
    const tenure = 3 + Math.floor(random() * 48);
    let usage = 25 + random() * 75;
    const riskBias = random() * 1.8 - 0.9;

    for (let month = 0; month < 6; month += 1) {
      const date = new Date(Date.UTC(2026, month + 1, 28));
      const previousUsage = usage;
      const deteriorate = random() < 0.3 ? 0.55 + random() * 0.25 : 0.88 + random() * 0.25;
      usage = Math.max(1, usage * deteriorate + (random() - 0.5) * 8);
      const tickets = Math.max(0, Math.round(random() * 2 + (previousUsage - usage > 20 ? 2 : 0) + Math.max(riskBias, 0)));
      const latePayments = Math.max(0, Math.round((random() < 0.15 ? 1 : 0) + (riskBias > 0.5 && random() < 0.35 ? 1 : 0)));
      const activeDays = Math.max(1, Math.min(30, Math.round(8 + usage / 5 + (random() - 0.5) * 5)));
      const z = -2.3 + 2.0 * Math.max(0, (previousUsage - usage) / Math.max(previousUsage, 1)) + 0.38 * tickets + 0.75 * latePayments - 0.035 * activeDays + 0.018 * (month + tenure) + riskBias;
      const churnProbability = sigmoid(z);
      const observedChurn = random() < churnProbability ? 1 : 0;
      const renewal = new Date(Date.UTC(2026, month + 2 + Math.floor(random() * 4), 10 + Math.floor(random() * 15)));

      rows.push({
        customerId: `C${String(customer).padStart(3, '0')}`,
        snapshotDate: date.toISOString().slice(0, 10),
        renewalDate: renewal.toISOString().slice(0, 10),
        monthlyRevenue: Math.round(baseRevenue),
        planTier: tier,
        usage30d: Math.round(usage),
        usagePrev30d: Math.round(previousUsage),
        tickets30d: tickets,
        latePayments90d: latePayments,
        tenureMonths: tenure + month,
        activeDays30d: activeDays,
        churned: month === 5 ? null : observedChurn,
      });
    }
  }

  return rows;
}
