export function parseInstant(value, field = '时间') {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(String(value));
  if (!Number.isFinite(ms)) {
    throw new Error(`${field}不是有效时间：${value}`);
  }
  return ms;
}

export function optionalInstant(value, field) {
  if (value == null || value === '') return null;
  return parseInstant(value, field);
}

export function toIso(value, field) {
  return new Date(parseInstant(value, field)).toISOString();
}

export function optionalIso(value, field) {
  if (value == null || value === '') return null;
  return toIso(value, field);
}
