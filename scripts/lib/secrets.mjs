const SECRET_KEY = /token|password|secret|apikey|api_key|authorization|cookie|jwt|session|bearer|credential|private.?key/i;
// `sid` only as a word of its own (sid, connect_sid, SID, userSid), never inside one (president).
const SID_WORD = /(^|[^A-Za-z])sid([^A-Za-z]|$)/i;
const CAMEL_SID = /[a-z]Sid$/;

const isSecretKey = (key) => SECRET_KEY.test(key) || SID_WORD.test(key) || CAMEL_SID.test(key);

/**
 * Deep copy of `value` with the value of every secret-looking key replaced by `***`. A secret
 * under an innocent key is not caught: pair it with `redactValues` on the known secret values.
 */
export function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, isSecretKey(key) ? '***' : maskSecrets(v)]),
    );
  }
  return value;
}

const MIN_REDACTED_LENGTH = 4;

/**
 * `text` with every occurrence of each value, raw or JSON-escaped, replaced by `***`. Values
 * shorter than 4 characters (or empty / not strings) are ignored so that a short value cannot
 * mask the text.
 */
export function redactValues(text, values) {
  const strings = values.filter((value) => typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH);
  const candidates = [...new Set([...strings, ...strings.map((value) => JSON.stringify(value).slice(1, -1))])]
    .sort((a, b) => b.length - a.length);
  return candidates.reduce((out, value) => out.split(value).join('***'), text);
}
