const SECRET_KEY = /token|password|secret|apikey|api_key|authorization|cookie/i;

/** Deep copy of `value` with the value of every secret-looking key replaced by `***`. */
export function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) ? '***' : maskSecrets(v)]),
    );
  }
  return value;
}

const MIN_REDACTED_LENGTH = 4;

/**
 * `text` with every occurrence of each value replaced by `***`. Values shorter than 4
 * characters (or empty / not strings) are ignored so that a short value cannot mask the text.
 */
export function redactValues(text, values) {
  const candidates = [...new Set(values)]
    .filter((value) => typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH)
    .sort((a, b) => b.length - a.length);
  return candidates.reduce((out, value) => out.split(value).join('***'), text);
}
