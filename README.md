# Day 04 — Retention Economics Lab

**100 Days of Data Science · Day 04**

**Live product:** https://day04-retention-economics-lab.vercel.app  
**Repository:** https://github.com/omparekh54-lgtm/day04-retention-economics-lab

Retention Economics Lab turns customer snapshot exports into a capacity-aware retention work queue. It does not stop at “who may churn?” The product combines observational churn probability with customer contribution value, renewal urgency, intervention cost, and an explicitly user-controlled save-rate scenario so a customer-success team can decide **which accounts deserve scarce attention first**.

## Why this is not just another churn dashboard

Most churn demos end with a probability chart. That is not an operating decision. A 90% churn-risk account with low value and a renewal eleven months away may be less urgent than a 62% risk account worth 20× more that renews next week.

Retention Economics Lab separates four layers: **known facts**, **statistical evidence**, **model predictions**, and **scenario economics**. The application never calls scenario value “causal uplift.” Without defensible treatment/control data, it explicitly says the intervention effect is unknown.

## Primary workflow

Upload CSV / XLSX / XLS customer snapshots → review/map columns → validate → train only on labelled historical rows → evaluate on a strict latest-period holdout → score current unlabeled customer snapshots → inspect risk drivers/trajectory → set intervention economics → constrain by team capacity → export prioritized retention queue.

A single file can contain both historical labelled rows and current scoring rows. Keep `churned` as `0` or `1` for historical outcomes and leave it **blank for current snapshots whose future outcome is not yet known**. Blank current rows are never used to train or evaluate the model.

## Input contract

Required columns: `customer_id`, `snapshot_date`, `monthly_revenue`, `usage_30d`, `usage_prev_30d`, `tickets_30d`, `late_payments_90d`, `tenure_months`, `active_days_30d`, `churned`.

Recommended: `renewal_date`, `plan_tier`.

The `churned` column must exist because it supplies historical training outcomes, but the cell should be blank on current rows to score. Historical labels must mean churn within one consistent prediction horizon after each `snapshot_date`.

Dates should preferably use ISO `YYYY-MM-DD`. Text dates in `DD/MM/YYYY` or `DD-MM-YYYY` are parsed day-first. Invalid supplied renewal dates are rejected instead of silently being treated as unknown.

## Data science methodology

Only rows with observed `churned = 0/1` enter model training and evaluation. Labelled rows are sorted by `snapshot_date`. When at least two distinct labelled snapshot dates exist, a **whole-date temporal boundary** is used: earlier dates train the model and the latest period is held out. A row-level 80/20 fallback is used only when the dataset has a single labelled snapshot date, and the UI/README disclose that weaker validation condition.

The app reports ROC-AUC, Brier score, model accuracy, majority baseline, holdout size and the time boundary. ROC-AUC correctly gives half credit to tied positive/negative scores.

A regularized logistic regression is trained in-browser using standardized usage change, support tickets, late payments, tenure, active days and log monthly revenue. Local feature contributions are shown as predictive reason codes, not causal drivers.

For operational scoring, the latest snapshot per customer is found. If current unlabeled snapshots exist, **only those rows are scored**. Known churned accounts are never placed into the action queue. If no unlabeled current rows are supplied, the app falls back to scoring latest retained snapshots so older datasets can still demonstrate the workflow, and that fallback is explicitly disclosed in the methodology text.

Retention economics are scenario calculations:

`contribution value = monthly revenue × gross margin assumption × value horizon`

`scenario net value = churn probability × contribution value × assumed save rate − intervention cost`

`priority score = max(scenario net value, 0) × renewal urgency`

The capacity optimizer selects only the highest positive-priority accounts up to the user-set team capacity. The current scoring population is compared with training data through standardized mean shift as a lightweight drift warning.

## Privacy

Uploaded files are processed in the browser. This implementation has no application database or server-side persistence of uploaded customer rows.

## Product UX

Synthetic demo, downloadable template, automatic column suggestions, visible validation, responsive layout, interactive intervention assumptions, team-capacity slider, click-to-investigate rows, risk trajectory, reason codes, model-vs-baseline comparison, drift indicators, CSV export, and reduced-motion support.

The template now demonstrates the intended pattern directly: historical rows carry `0/1` churn outcomes and the most recent row leaves churn blank for scoring.

## Tests

Run `npm test` and `npm run build`.

The test suite covers temporal training/evaluation, non-trivial holdout discrimination on deterministic demo data, bounded and sorted risk scores, capacity limits, exclusion of scenario-negative interventions, unlabeled-current scoring, exclusion of known churned accounts, blank-label import behavior, day-first date parsing, invalid renewal-date rejection, and churn-label validation.

## Honest limitations

The model is demo-grade regularized logistic regression; post-hoc probability calibration is not fitted. Feature contribution is predictive rather than causal explanation. The save-rate is a scenario input rather than estimated uplift. Drift is a mean-shift warning rather than full production monitoring. The row-level fallback for a single labelled snapshot date is weaker than a true temporal validation design. Text dates with ambiguous slash notation are intentionally interpreted day-first; use ISO dates for cross-region portability. There is no authentication, CRM write-back, intervention persistence, or production MLOps layer in this portfolio version.

## Production verification

Production is built from the exact public GitHub `main` source. A release is considered verified only after tests, Next.js/TypeScript production compilation, deployment readiness, HTTP availability and runtime-error checks succeed. The final QA report records the exact verified counts and deployment state rather than treating documentation as proof.
