import { normalizePage } from './adapter.mjs';
import { resolvePolicy } from './policy.mjs';
import { readSource } from './source.mjs';
import { RecordStore } from './store.mjs';
import { toIso } from './time.mjs';

export async function collect({ source = readSource, store = new RecordStore() } = {}) {
  const page = await source();
  const records = normalizePage(page).map((record) => store.save(record));
  return { source: page.source, observedAt: page.observedAt ?? null, records, store };
}

/**
 * 客服查询入口：每次抓取只更新档案，答复时按咨询时间取版本，并封存答复快照。
 */
export class PolicyArchive {
  #store;
  #answers = [];

  constructor({ store = new RecordStore() } = {}) {
    this.#store = store;
  }

  get store() {
    return this.#store;
  }

  collect(options = {}) {
    return collect({ ...options, store: this.#store });
  }

  answer({
    policyId,
    inquiryAt,
    source,
    answeredAt = new Date().toISOString(),
  } = {}) {
    const resolution = resolvePolicy(this.#store.list(), { policyId, inquiryAt, source });
    const answer = {
      answerId: `answer-${this.#answers.length + 1}`,
      answeredAt: toIso(answeredAt, '答复时间'),
      policyId,
      inquiryAt: resolution.inquiryAt,
      status: resolution.status,
      source: resolution.source,
      basis:
        resolution.applied == null
          ? null
          : {
              version: resolution.applied.version,
              effectiveAt: resolution.applied.effectiveAt,
              effectiveUntil: resolution.applied.effectiveUntil,
              withdrawnAt: resolution.applied.withdrawnAt,
              content: resolution.applied.content,
              revision: resolution.applied.revision,
              observedAt: resolution.applied.observedAt,
              state: resolution.applied.state,
            },
      upcoming: resolution.upcoming.map((record) => ({
        version: record.version,
        effectiveAt: record.effectiveAt,
      })),
    };
    this.#answers.push(structuredClone(answer));
    return structuredClone(answer);
  }

  explain(answerId) {
    const answer = this.#answers.find((entry) => entry.answerId === answerId);
    if (!answer) {
      throw new Error(`没有答复 ${answerId}`);
    }
    return structuredClone(answer);
  }

  answers() {
    return this.#answers.map((answer) => structuredClone(answer));
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const separator = arg.indexOf('=');
    if (separator === -1) {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      args[arg.slice(2, separator)] = arg.slice(separator + 1);
    }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.at || !args.policy) {
    const result = await collect();
    console.log(
      JSON.stringify(
        { source: result.source, observedAt: result.observedAt, count: result.records.length },
        null,
        2,
      ),
    );
  } else {
    const archive = new PolicyArchive();
    await archive.collect();
    console.log(
      JSON.stringify(
        archive.answer({ policyId: args.policy, inquiryAt: args.at, source: args.source }),
        null,
        2,
      ),
    );
  }
}
