import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../src/adapter.mjs';
import { PolicyArchive } from '../src/pipeline.mjs';
import { RecordStore } from '../src/store.mjs';

function item(overrides = {}) {
  return {
    policyId: 'returns',
    version: 'v1',
    label: '退货政策旧版',
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

function archiveWith(...pages) {
  const archive = new PolicyArchive({ store: new RecordStore() });
  for (const records of pages) {
    for (const record of normalizePage(records)) archive.store.save(record);
  }
  return archive;
}

const NEXT_MONTH = item({
  version: 'v2',
  label: '退货政策新版',
  state: 'published',
  effectiveAt: '2026-12-01T00:00:00.000Z',
  content: '15 天内可无理由退货',
});

test('提前发布的下月政策在生效前不会被引用', () => {
  const archive = archiveWith(page([item(), NEXT_MONTH]));

  const before = archive.answer({ policyId: 'returns', inquiryAt: '2026-11-20T10:00:00Z' });
  assert.equal(before.status, 'resolved');
  assert.equal(before.basis.version, 'v1');
  assert.equal(before.basis.content, '7 天内可无理由退货');
  assert.deepEqual(
    before.upcoming.map((entry) => entry.version),
    ['v2'],
  );

  const onEffective = archive.answer({ policyId: 'returns', inquiryAt: '2026-12-01T00:00:00Z' });
  assert.equal(onEffective.basis.version, 'v2');
  assert.equal(onEffective.basis.content, '15 天内可无理由退货');
});

test('生效后不再引用仍被留存的旧条款', () => {
  const archive = archiveWith(page([item(), NEXT_MONTH]));
  const result = archive.answer({ policyId: 'returns', inquiryAt: '2027-03-01T00:00:00Z' });
  assert.equal(result.basis.version, 'v2');
});

test('咨询时间早于首个生效版本时明确返回无适用版本', () => {
  const archive = archiveWith(page([item()]));
  const result = archive.answer({ policyId: 'returns', inquiryAt: '2025-12-31T23:59:59Z' });
  assert.equal(result.status, 'no-effective-version');
  assert.equal(result.basis, null);
});

test('草稿版本永远不会被引用，但仍可被列为未来生效', () => {
  const archive = archiveWith(page([item(), { ...NEXT_MONTH, state: 'draft' }]));
  const result = archive.answer({ policyId: 'returns', inquiryAt: '2027-01-01T00:00:00Z' });
  assert.equal(result.basis.version, 'v1');
  assert.deepEqual(result.upcoming, []);
});

test('失效的版本在 effectiveUntil 之后不再被引用', () => {
  const archive = archiveWith(
    page([
      item({ effectiveUntil: '2026-12-01T00:00:00.000Z' }),
      NEXT_MONTH,
    ]),
  );
  assert.equal(
    archive.answer({ policyId: 'returns', inquiryAt: '2026-11-30T23:59:59Z' }).basis.version,
    'v1',
  );
  assert.equal(
    archive.answer({ policyId: 'returns', inquiryAt: '2026-12-01T00:00:00Z' }).basis.version,
    'v2',
  );
});

test('未知政策返回 unknown-policy 而不是旧版本', () => {
  const archive = archiveWith(page([item()]));
  const result = archive.answer({ policyId: 'missing', inquiryAt: '2026-11-20T00:00:00Z' });
  assert.equal(result.status, 'unknown-policy');
  assert.equal(result.basis, null);
});
