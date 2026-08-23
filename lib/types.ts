export interface CustomerSnapshot { customerId:string; snapshotDate:string; renewalDate:string|null; monthlyRevenue:number; planTier:string; usage30d:number; usagePrev30d:number; tickets30d:number; latePayments90d:number; tenureMonths:number; activeDays30d:number; churned:number|null; }
export interface Mapping { customerId:string; snapshotDate:string; renewalDate:string; monthlyRevenue:string; planTier:string; usage30d:string; usagePrev30d:string; tickets30d:string; latePayments90d:string; tenureMonths:string; activeDays30d:string; churned:string; }
export interface ParsedTable { fileName:string; columns:string[]; rows:Record<string,unknown>[]; }
export interface ValidationReport { accepted:CustomerSnapshot[]; rejected:Array<{row:number;reason:string}>; warnings:string[]; }
export interface ModelMetric { auc:number|null; brier:number; accuracy:number; baselineAccuracy:number; positiveRate:number; holdoutRows:number; }
export interface RiskReason { feature:string; label:string; contribution:number; direction:'risk'|'protective'; }
export interface CustomerScore { row:CustomerSnapshot; probability:number; reasons:RiskReason[]; contributionValue:number; daysToRenewal:number|null; urgency:number; scenarioNetValue:number; priorityScore:number; }
export interface DriftSignal { feature:string; standardizedShift:number; severity:'low'|'medium'|'high'; }
export interface ModelResult { metric:ModelMetric; scores:CustomerScore[]; drift:DriftSignal[]; featureWeights:Array<{feature:string;label:string;weight:number}>; trainDateMax:string; holdoutDateMin:string; methodology:string; }
