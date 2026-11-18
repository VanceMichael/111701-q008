export class RecordStore {
  #records = new Map();

  static keyOf(record) {
    return `${record.source}:${record.policyId}:${record.version}`;
  }

  save(record) {
    const key = RecordStore.keyOf(record);
    const previous = this.#records.get(key);
    if (!previous || record.revision >= previous.revision) {
      this.#records.set(key, structuredClone(record));
    }
    return structuredClone(this.#records.get(key));
  }

  list() {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  history(policyId, { source } = {}) {
    return this.list()
      .filter(
        (record) =>
          record.policyId === policyId && (source == null || record.source === source),
      )
      .sort(
        (a, b) =>
          Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) ||
          a.version.localeCompare(b.version),
      );
  }
}
