import { parseInstant } from './time.mjs';

function withdrawnAt(record) {
  if (record.withdrawnAt != null) {
    return parseInstant(record.withdrawnAt, '撤回时间');
  }
  if (record.state === 'withdrawn') {
    throw new Error(`政策 ${record.policyId}@${record.version} 已撤回但缺少 withdrawnAt`);
  }
  return null;
}

/**
 * 某个版本在 at 时刻是否有资格作为依据。
 *
 * 判断顺序刻意与“当前抓取到的最新版本”无关：
 * 1. draft 从未发布，不能引用；
 * 2. 必须在 effectiveAt 之后（含）才生效，提前发布的下月政策因此不会被提前引用；
 * 3. 超过 effectiveUntil 后失效；
 * 4. 撤回只影响撤回时刻之后的咨询，撤回前已发生的咨询仍以该版本为依据。
 */
function isEffectiveAt(record, at) {
  if (record.state === 'draft') return false;
  if (parseInstant(record.effectiveAt, '生效时间') > at) return false;
  if (record.effectiveUntil != null && at >= parseInstant(record.effectiveUntil, '失效时间')) {
    return false;
  }
  const withdrawn = withdrawnAt(record);
  return withdrawn == null || at < withdrawn;
}

function snapshot(record) {
  return structuredClone(record);
}

/**
 * 按咨询发生时间查找适用版本。
 *
 * @returns {{status: string, policyId: string, inquiryAt: string, applied: object|null, upcoming: object[]}}
 */
export function resolvePolicy(records, { policyId, inquiryAt, source } = {}) {
  if (!policyId) {
    throw new Error('查询缺少 policyId');
  }
  const at = parseInstant(inquiryAt, '咨询时间');
  const matching = records.filter((record) => record.policyId === policyId);
  const sources = [...new Set(matching.map((record) => record.source))];

  if (matching.length === 0 || (source != null && !sources.includes(source))) {
    return {
      status: 'unknown-policy',
      policyId,
      inquiryAt: new Date(at).toISOString(),
      source: source ?? null,
      applied: null,
      upcoming: [],
    };
  }
  if (source == null && sources.length > 1) {
    throw new Error(`政策 ${policyId} 存在多个来源（${sources.join('、')}），查询需指定来源`);
  }

  const candidates = matching.filter((record) => source == null || record.source === source);
  const applicable = candidates
    .filter((record) => isEffectiveAt(record, at))
    .sort((a, b) => parseInstant(b.effectiveAt) - parseInstant(a.effectiveAt));

  const upcoming = candidates
    .filter((record) => record.state !== 'draft' && record.state !== 'withdrawn')
    .filter((record) => parseInstant(record.effectiveAt) > at)
    .sort((a, b) => parseInstant(a.effectiveAt) - parseInstant(b.effectiveAt))
    .map(snapshot);

  if (applicable.length === 0) {
    return {
      status: 'no-effective-version',
      policyId,
      inquiryAt: new Date(at).toISOString(),
      source: candidates[0].source,
      applied: null,
      upcoming,
    };
  }

  return {
    status: 'resolved',
    policyId,
    inquiryAt: new Date(at).toISOString(),
    source: applicable[0].source,
    applied: snapshot(applicable[0]),
    upcoming,
  };
}
