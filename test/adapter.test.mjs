import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../src/adapter.mjs';
import { collect } from '../src/pipeline.mjs';
import { RecordStore } from '../src/store.mjs';

function item(overrides = {}) {
  return {
    policyId: 'returns',
    version: 'v1',
    label: '退货政策',
    state: 'active',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    content: '旧条款',
    revision: 1,
    ...overrides,
  };
}

function page(items, observedAt = '2026-11-17T08:00:00.000Z') {
  return { source: 'local', observedAt, items };
}

test('采集链保留来源、记录身份和观察时间', async () => {
  const store = new RecordStore();
  const result = await collect({ source: async () => page([item()]), store });
  assert.equal(result.records[0].source, 'local');
  assert.equal(result.records[0].policyId, 'returns');
  assert.equal(result.records[0].observedAt, '2026-11-17T08:00:00.000Z');
  assert.equal(store.list().length, 1);
});

test('同一政策版本按较新的修订号更新', () => {
  const store = new RecordStore();
  store.save(normalizePage(page([item({ content: '旧值' })]))[0]);
  store.save(normalizePage(page([item({ content: '新值', revision: 2 })]))[0]);
  assert.equal(store.list()[0].content, '新值');
  assert.equal(store.history('returns').length, 1);

  store.save(normalizePage(page([item({ content: '更旧', revision: 0 })]))[0]);
  assert.equal(store.list()[0].content, '新值');
});

test('不同版本各自保留，不互相覆盖', () => {
  const store = new RecordStore();
  for (const record of normalizePage(
    page([item(), item({ version: 'v2', effectiveAt: '2026-12-01T00:00:00.000Z' })]),
  )) {
    store.save(record);
  }
  assert.deepEqual(
    store.history('returns').map((record) => record.version),
    ['v1', 'v2'],
  );
});

test('不完整或自相矛盾的来源记录被拒绝', () => {
  assert.throws(() => normalizePage(page([{ policyId: 'returns' }])), /缺少/);
  assert.throws(() => normalizePage(page([item({ state: 'pending' })])), /state 未知/);
  assert.throws(() => normalizePage(page([item({ effectiveAt: '下个月' })])), /不是有效时间/);
  assert.throws(() => normalizePage(page([item({ content: ' ' })])), /缺少 content/);
  assert.throws(() => normalizePage(page([item({ state: 'withdrawn' })])), /缺少 withdrawnAt/);
  assert.throws(
    () => normalizePage(page([item(), item()])),
    /政策版本重复/,
  );
  assert.throws(
    () =>
      normalizePage(
        page([
          item({ effectiveUntil: '2026-12-01T00:00:00.000Z' }),
          item({ version: 'v2', effectiveAt: '2026-06-01T00:00:00.000Z' }),
        ]),
      ),
    /适用区间重叠/,
  );
  assert.throws(
    () => normalizePage(page([item(), item({ version: 'v2' })])),
    /同时/,
  );
});
