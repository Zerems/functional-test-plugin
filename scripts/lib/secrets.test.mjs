import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets } from './secrets.mjs';

test('maskSecrets masks nested token, password, authorization and cookie keys, leaves others', () => {
  const input = {
    name: 'agency',
    accessToken: 'abc',
    nested: { password: 'p', list: [{ Authorization: 'Bearer x', id: 1 }], cookie: 'c=1' },
    client_secret: 's',
    apiKey: 'k',
    api_key: 'k2',
  };
  const out = maskSecrets(input);
  assert.equal(out.name, 'agency');
  assert.equal(out.accessToken, '***');
  assert.equal(out.nested.password, '***');
  assert.equal(out.nested.list[0].Authorization, '***');
  assert.equal(out.nested.list[0].id, 1);
  assert.equal(out.nested.cookie, '***');
  assert.equal(out.client_secret, '***');
  assert.equal(out.apiKey, '***');
  assert.equal(out.api_key, '***');
  assert.equal(input.accessToken, 'abc', 'input is not mutated');
});

test('maskSecrets passes primitives and null through', () => {
  assert.equal(maskSecrets('text'), 'text');
  assert.equal(maskSecrets(null), null);
  assert.equal(maskSecrets(3), 3);
});
