import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../src/adapter.mjs';
import { PolicyArchive } from '../src/pipeline.mjs';
import { RecordStore } from '../src/store.mjs';

function item(overrides = {}) {
  return {
    policyId: 'returns',
    version: 'v1',
    label: '退货政策',
    state: 'active',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    content: '7 天内可无理由退货',
    revision: 1,
    ...overrides,
  };
}

function page(items, observedAt = '2026-11-17T08:00:00.000Z') {
  return { source: 'local', observedAt, items };
}

function archiveWith(records) {
  const archive = new PolicyArchive({ store: new RecordStore() });
  for (const record of normalizePage(records)) archive.store.save(record);
  return archive;
}

const V2 = item({
  version: 'v2',
  state: 'published',
  effectiveAt: '2026-12-01T00:00:00.000Z',
  content: '15 天内可无理由退货',
});

test('答复封存所依据的版本快照，之后的抓取不会改写已发出的答复', () => {
  const archive = archiveWith(page([item(), V2]));
  const sent = archive.answer({
    policyId: 'returns',
    inquiryAt: '2026-11-20T10:00:00Z',
    answeredAt: '2026-11-20T10:05:00Z',
  });
  assert.equal(sent.basis.version, 'v1');
  assert.equal(sent.basis.content, '7 天内可无理由退货');
  assert.equal(sent.basis.revision, 1);

  // 生效后再抓取一次来源：同一 v1 版本被改写，v2 成为当前版本。
  for (const record of normalizePage(
    page([item({ content: '7 天内可无理由退货（已更新措辞）', revision: 2 }), V2], '2026-12-02T08:00:00.000Z'),
  )) {
    archive.store.save(record);
  }

  const explained = archive.explain('answer-1');
  assert.deepEqual(explained, sent);
  assert.equal(explained.basis.content, '7 天内可无理由退货');
  assert.equal(explained.basis.revision, 1);
  assert.equal(explained.answeredAt, '2026-11-20T10:05:00.000Z');
});

test('未来规则撤回后，答复仍能说明当时依据的版本与撤回时间', () => {
  const archive = archiveWith(page([item(), V2]));
  const sent = archive.answer({ policyId: 'returns', inquiryAt: '2026-12-15T00:00:00Z' });
  assert.equal(sent.basis.version, 'v2');

  // 品牌官网撤回 v2：新抓取把 v2 标为 withdrawn 并给出撤回时间。
  for (const record of normalizePage(
    page([
      item(),
      { ...V2, state: 'withdrawn', withdrawnAt: '2026-12-20T00:00:00.000Z', revision: 2 },
    ], '2026-12-21T08:00:00.000Z'),
  )) {
    archive.store.save(record);
  }

  const explained = archive.explain(sent.answerId);
  assert.equal(explained.basis.version, 'v2');
  assert.equal(explained.basis.withdrawnAt, null);
  assert.equal(explained.basis.content, '15 天内可无理由退货');

  // 撤回后的咨询不再引用 v2；撤回前的咨询仍按 v2 解释。
  const afterWithdrawal = archive.answer({
    policyId: 'returns',
    inquiryAt: '2026-12-22T00:00:00Z',
  });
  assert.equal(afterWithdrawal.basis.version, 'v1');

  const beforeWithdrawal = archive.answer({
    policyId: 'returns',
    inquiryAt: '2026-12-19T00:00:00Z',
  });
  assert.equal(beforeWithdrawal.basis.version, 'v2');
});

test('同一政策的多个来源必须显式指定，不能凭抓取顺序猜测', () => {
  const archive = archiveWith(page([item()]));
  for (const record of normalizePage({
    source: 'other-site',
    observedAt: '2026-11-17T08:00:00.000Z',
    items: [item({ content: '另一个来源的条款' })],
  })) {
    archive.store.save(record);
  }
  assert.throws(
    () => archive.answer({ policyId: 'returns', inquiryAt: '2026-11-20T00:00:00Z' }),
    /多个来源/,
  );
  const result = archive.answer({
    policyId: 'returns',
    inquiryAt: '2026-11-20T00:00:00Z',
    source: 'other-site',
  });
  assert.equal(result.basis.content, '另一个来源的条款');
});

test('无效咨询时间被拒绝', () => {
  const archive = archiveWith(page([item()]));
  assert.throws(
    () => archive.answer({ policyId: 'returns', inquiryAt: '昨天' }),
    /不是有效时间/,
  );
  assert.throws(() => archive.explain('answer-404'), /没有答复/);
});
