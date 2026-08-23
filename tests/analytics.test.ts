import test from 'node:test'; import assert from 'node:assert/strict';
import { demoRows } from '../lib/demo.ts'; import { capacitySelection, trainRetentionModel } from '../lib/analytics.ts';
const assumptions={grossMarginPct:70,valueHorizonMonths:12,interventionCost:80,assumedSaveRatePct:25};
test('model uses a strict time boundary and useful discrimination',()=>{const result=trainRetentionModel(demoRows(),assumptions);assert.ok(result.metric.holdoutRows>50);assert.ok(result.metric.auc!==null);assert.ok((result.metric.auc??0)>.55);assert.ok(result.trainDateMax<result.holdoutDateMin);});
test('scores are bounded and prioritized',()=>{const result=trainRetentionModel(demoRows(),assumptions);assert.ok(result.scores.every(s=>s.probability>=0&&s.probability<=1));for(let i=1;i<result.scores.length;i++)assert.ok(result.scores[i-1].priorityScore>=result.scores[i].priorityScore);});
test('capacity selection respects economics and capacity',()=>{const result=trainRetentionModel(demoRows(),assumptions);const selected=capacitySelection(result.scores,12);assert.ok(selected.length<=12);assert.ok(selected.every(s=>s.scenarioNetValue>0));});
