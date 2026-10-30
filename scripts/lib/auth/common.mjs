/** Expiry of a credential that never expires on its own. */
export const FAR_FUTURE = '9999-12-31T00:00:00.000Z';

/** Request headers of an auth: the preset's own, then the section's static map, then the per-call context. */
export function mergeHeaders(own, section, context) {
  return { ...own, ...section.headers, ...context };
}
