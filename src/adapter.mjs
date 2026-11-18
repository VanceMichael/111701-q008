import { optionalIso, toIso } from './time.mjs';

export const POLICY_STATES = new Set(['draft', 'published', 'active', 'withdrawn']);

function normalizePolicy(item, page) {
  if (!item.policyId || !item.version || !item.label) {
    throw new Error('政策记录缺少 policyId、version 或 label');
  }
  const state = String(item.state ?? '');
  if (!POLICY_STATES.has(state)) {
    throw new Error(`政策 ${item.policyId}@${item.version} 的 state 未知或缺失：${item.state}`);
  }
  const content = String(item.content ?? '').trim();
  if (!content) {
    throw new Error(`政策 ${item.policyId}@${item.version} 缺少 content`);
  }
  const revision = Number(item.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`政策 ${item.policyId}@${item.version} 的 revision 无效：${item.revision}`);
  }
  const withdrawnAt = optionalIso(
    item.withdrawnAt,
    `政策 ${item.policyId}@${item.version} 的 withdrawnAt`,
  );
  if (state === 'withdrawn' && withdrawnAt == null) {
    throw new Error(`政策 ${item.policyId}@${item.version} 已撤回但缺少 withdrawnAt`);
  }
  return {
    source: page.source,
    policyId: String(item.policyId),
    version: String(item.version),
    name: String(item.label).trim(),
    state,
    effectiveAt: toIso(
      item.effectiveAt,
      `政策 ${item.policyId}@${item.version} 的 effectiveAt`,
    ),
    effectiveUntil: optionalIso(
      item.effectiveUntil,
      `政策 ${item.policyId}@${item.version} 的 effectiveUntil`,
    ),
    withdrawnAt,
    content,
    revision,
    observedAt: page.observedAt ?? null,
  };
}

function validateTimeline(versions) {
  const byPolicy = new Map();
  const seen = new Set();
  for (const version of versions) {
    const key = `${version.policyId}@${version.version}`;
    if (seen.has(key)) {
      throw new Error(`同一来源页中政策版本重复：${key}`);
    }
    seen.add(key);
    if (
      version.effectiveUntil != null &&
      Date.parse(version.effectiveUntil) <= Date.parse(version.effectiveAt)
    ) {
      throw new Error(`政策 ${key} 的 effectiveUntil 不晚于 effectiveAt`);
    }
    const group = byPolicy.get(version.policyId) ?? [];
    group.push(version);
    byPolicy.set(version.policyId, group);
  }

  for (const [policyId, group] of byPolicy) {
    group.sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (current.effectiveAt === previous.effectiveAt) {
        throw new Error(
          `政策 ${policyId} 的版本 ${previous.version} 与 ${current.version} 同时在 ${current.effectiveAt} 生效`,
        );
      }
      if (
        previous.effectiveUntil != null &&
        Date.parse(previous.effectiveUntil) > Date.parse(current.effectiveAt)
      ) {
        throw new Error(
          `政策 ${policyId} 的版本 ${previous.version} 与 ${current.version} 的适用区间重叠`,
        );
      }
    }
  }
}

export function normalizePage(page) {
  if (!page || !page.source || !Array.isArray(page.items)) {
    throw new Error('来源页缺少 source 或 items');
  }
  const observedAt = optionalIso(page.observedAt, '来源页 observedAt');
  const versions = page.items.map((item) => normalizePolicy({ ...item }, { ...page, observedAt }));
  validateTimeline(versions);
  return versions;
}
