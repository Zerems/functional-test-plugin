/**
 * Test double for `fetch`. `routes` is an array of
 * `{ match: (url, init) => boolean, status = 200, body }`; the first matching
 * route answers (`body` is serialised as JSON unless it is a string).
 * The returned function records every call in `calls: [{ url, init }]`.
 */
export function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const call = { url: String(url), init };
    calls.push(call);
    const route = routes.find((r) => r.match(call.url, init));
    if (!route) throw new Error(`fakeFetch: no route for ${call.url}`);
    const { status = 200, body } = route;
    const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    return new Response(payload, { status });
  };
  impl.calls = calls;
  return impl;
}
