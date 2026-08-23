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

interface PreparedRow { row: CustomerSnapshot; y: number; x: number[]; }

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}
function sigmoid(x:number){if(x>=0){const z=Math.exp(-x);return 1/(1+z);}const z=Math.exp(x);return z/(1+z);}
function featureVector(row:CustomerSnapshot):number[]{const usageChange=row.usagePrev30d>0?clamp(row.usage30d/row.usagePrev30d-1,-1.5,2):0;return[usageChange,row.tickets30d,row.latePayments90d,row.tenureMonths,row.activeDays30d,Math.log1p(row.monthlyRevenue)];}
function mean(values:number[]){return values.reduce((a,b)=>a+b,0)/Math.max(values.length,1);}
function standardDeviation(values:number[],avg:number){return Math.sqrt(values.reduce((s,v)=>s+(v-avg)**2,0)/Math.max(values.length-1,1))||1;}
function standardizers(rows:PreparedRow[]){return FEATURES.map((_,i)=>{const values=rows.map(r=>r.x[i]);const m=mean(values);return{mean:m,sd:standardDeviation(values,m)};});}
function transform(x:number[],stats:Array<{mean:number;sd:number}>){return x.map((v,i)=>(v-stats[i].mean)/stats[i].sd);}

function fitLogistic(train:PreparedRow[],stats:Array<{mean:number;sd:number}>){const n=train.length,p=FEATURES.length,w=new Array(p+1).fill(0),rate=.08,l2=.08;for(let epoch=0;epoch<700;epoch++){const grad=new Array(p+1).fill(0);for(const item of train){const x=transform(item.x,stats);let z=w[0];for(let j=0;j<p;j++)z+=w[j+1]*x[j];const error=sigmoid(z)-item.y;grad[0]+=error;for(let j=0;j<p;j++)grad[j+1]+=error*x[j];}w[0]-=rate*grad[0]/n;for(let j=1;j<=p;j++)w[j]-=rate*(grad[j]/n+l2*w[j]/n);}return w;}
function predict(xRaw:number[],w:number[],stats:Array<{mean:number;sd:number}>){const x=transform(xRaw,stats);let z=w[0];for(let j=0;j<x.length;j++)z+=w[j+1]*x[j];return sigmoid(z);}
function aucScore(labels:number[],probs:number[]):number|null{const positives=labels.filter(v=>v===1).length,negatives=labels.length-positives;if(!positives||!negatives)return null;const pairs=probs.map((p,i)=>({p,y:labels[i]})).sort((a,b)=>a.p-b.p);let rankSum=0;for(let i=0;i<pairs.length;i++)if(pairs[i].y===1)rankSum+=i+1;return(rankSum-positives*(positives+1)/2)/(positives*negatives);}
function metrics(labels:number[],probs:number[],prior:number):ModelMetric{const pred=probs.map(p=>p>=.5?1:0),majority=prior>=.5?1:0;return{auc:aucScore(labels,probs),brier:mean(probs.map((p,i)=>(p-labels[i])**2)),accuracy:mean(pred.map((v,i)=>v===labels[i]?1:0)),baselineAccuracy:mean(labels.map(y=>y===majority?1:0)),positiveRate:mean(labels),holdoutRows:labels.length};}
function parseDate(value:string|null):Date|null{if(!value)return null;const d=new Date(`${value}T00:00:00Z`);return Number.isNaN(d.valueOf())?null:d;}
function daysBetween(a:string,b:string|null){const d1=parseDate(a),d2=parseDate(b);if(!d1||!d2)return null;return Math.round((d2.getTime()-d1.getTime())/86400000);}
function reasonsFor(row:CustomerSnapshot,w:number[],stats:Array<{mean:number;sd:number}>):RiskReason[]{const x=transform(featureVector(row),stats);return FEATURES.map((f,i)=>({feature:f[0],label:f[1],contribution:w[i+1]*x[i],direction:(w[i+1]*x[i]>=0?'risk':'protective') as 'risk'|'protective'})).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)).slice(0,3);}

function splitPreparedByTime(labelled:PreparedRow[]){const dates=Array.from(new Set(labelled.map(r=>r.row.snapshotDate))).sort();if(dates.length>=3){const cutIndex=Math.min(dates.length-1,Math.max(1,Math.floor(dates.length*.8)));const holdoutStart=dates[cutIndex];return{train:labelled.filter(r=>r.row.snapshotDate<holdoutStart),holdout:labelled.filter(r=>r.row.snapshotDate>=holdoutStart),mode:'date-boundary' as const};}const split=Math.max(30,Math.floor(labelled.length*.8));return{train:labelled.slice(0,split),holdout:labelled.slice(split),mode:'row-fallback' as const};}

export function trainRetentionModel(rows:CustomerSnapshot[],assumptions:ScenarioAssumptions):ModelResult{const labelled=rows.filter((r):r is CustomerSnapshot&{churned:number}=>r.churned===0||r.churned===1).map(r=>({row:r,y:r.churned as number,x:featureVector(r)})).sort((a,b)=>a.row.snapshotDate.localeCompare(b.row.snapshotDate));if(labelled.length<50)throw new Error('At least 50 labelled historical rows are required to train a stable demo-grade model.');if(new Set(labelled.map(r=>r.y)).size<2)throw new Error('Churn labels need both 0 and 1 examples.');const{train,holdout,mode}=splitPreparedByTime(labelled);if(new Set(train.map(r=>r.y)).size<2)throw new Error('The training period needs both churned and retained examples.');if(!holdout.some(r=>r.y===1)||!holdout.some(r=>r.y===0))throw new Error('Latest holdout period must contain both churned and retained examples.');const stats=standardizers(train),w=fitLogistic(train,stats),prior=mean(train.map(r=>r.y)),holdProbs=holdout.map(r=>predict(r.x,w,stats)),metric=metrics(holdout.map(r=>r.y),holdProbs,prior);const latestByCustomer=new Map<string,CustomerSnapshot>();for(const row of rows){const prev=latestByCustomer.get(row.customerId);if(!prev||row.snapshotDate>prev.snapshotDate)latestByCustomer.set(row.customerId,row);}const latest=[...latestByCustomer.values()];const scores:CustomerScore[]=latest.map(row=>{const probability=predict(featureVector(row),w,stats),days=daysBetween(row.snapshotDate,row.renewalDate),urgency=days===null?1:1+clamp((90-days)/90,0,1.5),contributionValue=row.monthlyRevenue*(assumptions.grossMarginPct/100)*assumptions.valueHorizonMonths,scenarioNetValue=probability*contributionValue*(assumptions.assumedSaveRatePct/100)-assumptions.interventionCost;return{row,probability,reasons:reasonsFor(row,w,stats),contributionValue,daysToRenewal:days,urgency,scenarioNetValue,priorityScore:Math.max(0,scenarioNetValue)*urgency};}).sort((a,b)=>b.priorityScore-a.priorityScore);const latestPrepared=latest.map(row=>({row,y:0,x:featureVector(row)}));const drift:DriftSignal[]=FEATURES.map((f,i)=>{const shift=(mean(latestPrepared.map(r=>r.x[i]))-stats[i].mean)/stats[i].sd,abs=Math.abs(shift);return{feature:f[1],standardizedShift:shift,severity:(abs>=1?'high':abs>=.5?'medium':'low') as DriftSignal['severity']};}).sort((a,b)=>Math.abs(b.standardizedShift)-Math.abs(a.standardizedShift));return{metric,scores,drift,featureWeights:FEATURES.map((f,i)=>({feature:f[0],label:f[1],weight:w[i+1]})).sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)),trainDateMax:train.at(-1)?.row.snapshotDate??'',holdoutDateMin:holdout[0]?.row.snapshotDate??'',methodology:`Regularized logistic regression with ${mode==='date-boundary'?'a whole-date temporal holdout':'an 80/20 row fallback because too few distinct snapshot dates were available'}. Probabilities are observational predictions; retention intervention value uses user-controlled scenario assumptions and is not a causal uplift estimate.`};}

export function riskTrajectory(rows:CustomerSnapshot[],customerId:string):Array<{date:string;probability:number}>{const labelled=rows.filter(r=>r.churned===0||r.churned===1).map(r=>({row:r,y:r.churned as number,x:featureVector(r)})).sort((a,b)=>a.row.snapshotDate.localeCompare(b.row.snapshotDate));const{train}=splitPreparedByTime(labelled);const stats=standardizers(train),w=fitLogistic(train,stats);return rows.filter(r=>r.customerId===customerId).sort((a,b)=>a.snapshotDate.localeCompare(b.snapshotDate)).map(r=>({date:r.snapshotDate,probability:predict(featureVector(r),w,stats)}));}
export function capacitySelection(scores:CustomerScore[],capacity:number){return scores.filter(s=>s.scenarioNetValue>0).slice(0,Math.max(0,capacity));}
export function money(value:number,currency='USD'){return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(value);}
export function pct(value:number){return`${(value*100).toFixed(1)}%`;}
