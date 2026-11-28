import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBudgetHeadroom} from '../scripts/s47/budget.mjs';

test('a browser sequence stops before consuming the original-operation lookup reserve',()=>{
  const counts={textHTTP:130,allSaveEntrances:32,lookups:3};
  const limits={textHTTP:180,allSaveEntrances:36,lookups:16};
  assert.throws(()=>assertBudgetHeadroom(counts,limits,{textHTTP:74,allSaveEntrances:3,lookups:3},'CHROME'),
    /BUDGET_CHROME_TEXTHTTP/);
  assert.deepEqual(counts,{textHTTP:130,allSaveEntrances:32,lookups:3});
  assert.doesNotThrow(()=>assertBudgetHeadroom(counts,limits,{textHTTP:8,lookups:2},'RECONCILIATION'));
});

test('headroom accepts the exact ceiling and rejects an exhausted save dimension',()=>{
  const counts={textHTTP:176,allSaveEntrances:35};
  const limits={textHTTP:180,allSaveEntrances:36};
  assert.doesNotThrow(()=>assertBudgetHeadroom(counts,limits,{textHTTP:4,allSaveEntrances:1}));
  assert.throws(()=>assertBudgetHeadroom(counts,limits,{textHTTP:4,allSaveEntrances:2}),
    /BUDGET_REQUEST_ALLSAVEENTRANCES/);
  assert.throws(()=>assertBudgetHeadroom(counts,limits,{unknown:1}),/INVALID_BUDGET_ALLOCATION/);
});
