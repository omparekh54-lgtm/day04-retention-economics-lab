# Day 04 — Retention Economics Lab

**100 Days of Data Science · Day 04**

**Live product:** https://day04-retention-economics-lab.vercel.app  
**Repository:** https://github.com/omparekh54-lgtm/day04-retention-economics-lab

Retention Economics Lab turns customer snapshot exports into a capacity-aware retention work queue. It does not stop at “who may churn?” The product combines observational churn probability with customer contribution value, renewal urgency, intervention cost, and an explicitly user-controlled save-rate scenario so a customer-success team can decide **which accounts deserve scarce attention first**.

## Why this is not just another churn dashboard

Most churn demos end with a probability chart. That is not an operating decision. A 90% churn-risk account with low value and a renewal eleven months away may be less urgent than a 62% risk account worth 20× more that renews next week.

Retention Economics Lab separates four layers: **known facts**, **statistical evidence**, **model predictions**, and **scenario economics**. The application never calls scenario value “causal uplift.” Without defensible treatment/control data, it explicitly says the intervention effect is unknown.

## Primary workflow

Upload CSV / XLSX / XLS customer snapshots → review/map columns → validate → train on earliest 80% → evaluate on latest 20% → score latest customer snapshots → inspect risk drivers/trajectory → set intervention economics → constrain by team capacity → export prioritized retention queue.

## Input contract

Required fields: `customer_id`, `snapshot_date`, `monthly_revenue`, `usage_30d`, `usage_prev_30d`, `tickets_30d`, `late_payments_90d`, `tenure_months`, `active_days_30d`, `churned`.

Recommended: `renewal_date`, `plan_tier`.

The `churned` label must mean churn within one consistent prediction horizon after each `snapshot_date`.

## Data science methodology

Rows are sorted by `snapshot_date`. The earliest 80% form training data and the latest 20% form the holdout period. The app reports ROC-AUC, Brier score, model accuracy, majority baseline, holdout size and the time boundary.

A regularized logistic regression is trained in-browser using standardized usage change, support tickets, late payments, tenure, active days and log monthly revenue. Local feature contributions are shown as predictive reason codes, not causal drivers.

Retention economics are scenario calculations:

`contribution value = monthly revenue × gross margin assumption × value horizon`

`scenario net value = churn probability × contribution value × assumed save rate − intervention cost`

`priority score = max(scenario net value, 0) × renewal urgency`

The capacity optimizer selects only the highest positive-priority accounts up to the user-set team capacity. The latest scoring population is compared with training data through standardized mean shift as a lightweight drift warning.

## Privacy

Uploaded files are processed in the browser. This implementation has no application database or server-side persistence of uploaded customer rows.

## Product UX

Synthetic demo, downloadable template, automatic column suggestions, visible validation, responsive layout, interactive intervention assumptions, team-capacity slider, click-to-investigate rows, risk trajectory, reason codes, model-vs-baseline comparison, drift indicators, CSV export, and reduced-motion support.

## Verified production checks

The production Vercel build fetches the exact GitHub `main` branch before testing and compiling. The corrected production release passed:

- 3 / 3 analytics tests
- deterministic demo holdout ROC-AUC ≈ 0.700
- holdout Brier score ≈ 0.162
- holdout accuracy ≈ 78.6% vs ≈ 76.2% majority baseline
- Next.js 16 production compilation
- TypeScript checking
- production deployment state `READY`
- production root HTTP 200 through Vercel fetch
- current Vercel runtime scan: no runtime errors

A direct Chromium click-through from the automation execution environment could not be completed because public Vercel navigation is blocked there with `ERR_BLOCKED_BY_ADMINISTRATOR`. This is an execution-environment restriction, not an application runtime error, and is documented rather than reported as a successful UI automation test.

## Tests

Run `npm test` and `npm run build`.

The analytics tests cover time-aware training, non-trivial holdout AUC on deterministic demo data, probability bounds, priority ordering, capacity limits, and exclusion of scenario-negative interventions.

## Honest limitations

The model is demo-grade logistic regression, feature contribution is predictive rather than causal explanation, the save-rate is a scenario input rather than estimated uplift, post-hoc probability calibration is not fitted, drift is a mean-shift warning rather than full production monitoring, and there is no authentication/CRM persistence in this portfolio version.
