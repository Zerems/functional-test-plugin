import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from './config.mjs';
import { MissingSecretError, TrackerError } from './errors.mjs';
import { exitCodeFor, parseFlags, reportError, UsageError } from './cli.mjs';
import { translator } from './i18n.mjs';

const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

test('exitCodeFor maps each error family to its exit code', () => {
  assert.equal(exitCodeFor(new ConfigError(['x: bad'])), 2);
  assert.equal(exitCodeFor(new UsageError('usage: x')), 2);
  assert.equal(exitCodeFor(new MissingSecretError(['A'])), 3);
  assert.equal(exitCodeFor(new TrackerError('nope', { status: 404, path: '/x' })), 2);
  assert.equal(exitCodeFor(new TrackerError('boom', { status: 500, path: '/x' })), 4);
  assert.equal(exitCodeFor(networkError('ECONNREFUSED')), 4);
  assert.equal(exitCodeFor(networkError('ENOTFOUND')), 4);
  assert.equal(exitCodeFor(new TypeError('fetch failed')), 4);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { name: 'AbortError' })), 4);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { name: 'TimeoutError' })), 4);
  assert.equal(exitCodeFor(new Error('anything else')), 1);
  assert.equal(exitCodeFor(new TypeError('not a network problem')), 1);
});

function capture() {
  let text = '';
  return { stream: { write: (chunk) => (text += chunk) }, get text() { return text; } };
}

test('reportError writes the translated message on stderr and returns the exit code', () => {
  const t = translator('en');
  const out = capture();
  assert.equal(reportError(new MissingSecretError(['JIRA_EMAIL', 'JIRA_API_TOKEN']), t, { stderr: out.stream }), 3);
  assert.equal(out.text, 'missing environment variables: JIRA_EMAIL, JIRA_API_TOKEN\n');

  const tracker = capture();
  assert.equal(reportError(new TrackerError('Jira 500', { status: 500, path: '/x' }), t, { stderr: tracker.stream }), 4);
  assert.equal(tracker.text, 'tracker error: Jira 500\n');

  const notFound = capture();
  const missing = new TrackerError('Jira 404', { status: 404, path: '/x' });
  assert.equal(reportError(missing, t, { stderr: notFound.stream, notFound: 'ticket not found: WV-1' }), 2);
  assert.equal(notFound.text, 'ticket not found: WV-1\n');

  const network = capture();
  assert.equal(reportError(networkError('ECONNREFUSED'), t, { stderr: network.stream }), 4);
  assert.equal(network.text, 'network error: fetch failed\n');
  const asTracker = capture();
  reportError(networkError('ECONNREFUSED'), t, { stderr: asTracker.stream, networkKey: 'cli.trackerError' });
  assert.equal(asTracker.text, 'tracker error: fetch failed\n');

  const config = capture();
  assert.equal(reportError(new ConfigError(['a: bad', 'b: bad']), t, { stderr: config.stream }), 2);
  assert.equal(config.text, 'a: bad\nb: bad\n');

  const other = capture();
  assert.equal(reportError(new Error('login refused'), t, { stderr: other.stream }), 1);
  assert.equal(other.text, 'login refused\n');
});

test('parseFlags splits flags from positionals and applies defaults', () => {
  const spec = { env: 'string', json: 'boolean', header: 'list' };
  assert.deepEqual(parseFlags(['a', '--json', '--env', 'demo', '--header', 'A=1', 'b', '--header', 'B=2'], spec, 'usage: x'), {
    flags: { env: 'demo', json: true, header: ['A=1', 'B=2'] },
    positionals: ['a', 'b'],
  });
  assert.deepEqual(parseFlags([], spec, 'usage: x'), { flags: { env: null, json: false, header: [] }, positionals: [] });
});

test('parseFlags throws a UsageError carrying the usage line for unknown flags and missing values', () => {
  const spec = { env: 'string', json: 'boolean' };
  for (const argv of [['--nope'], ['--env'], ['--env', '--json']]) {
    assert.throws(() => parseFlags(argv, spec, 'usage: x'), (error) => error instanceof UsageError && error.message === 'usage: x');
  }
});
