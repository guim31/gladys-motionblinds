// -----------------------------------------------------------------------------
// Configuration normalization: addresses, key, interval, gates, language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    key: '',
    keyStatus: 'missing',
    pollSeconds: 30,
    allowGates: false,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
});

test('addresses: several, cleaned, invalid ones set aside', () => {
  assert.deepEqual(
    parseHosts(' 192.168.1.40, 192.168.001.41;192.168.1.40\n300.1.1.1 bridge.local'),
    {
      hosts: ['192.168.1.40', '192.168.1.41'],
      invalid: ['300.1.1.1', 'bridge.local'],
    },
  );
});

test('the key: trimmed, 16 characters', () => {
  assert.equal(normalizeConfig({ key: ' 12ab345c-d67e-8f ' }).keyStatus, 'ok');
  assert.equal(normalizeConfig({ key: ' 12ab345c-d67e-8f ' }).key, '12ab345c-d67e-8f');
  assert.equal(normalizeConfig({ key: '12ab345c' }).keyStatus, 'invalid');
});

test('interval, gates and language: unknown values fall back to the defaults', () => {
  assert.equal(normalizeConfig({ poll_interval: '10' }).pollSeconds, 10);
  assert.equal(normalizeConfig({ poll_interval: '300' }).pollSeconds, 30);
  assert.equal(normalizeConfig({ allow_gates: true }).allowGates, true);
  assert.equal(normalizeConfig({ allow_gates: 'true' }).allowGates, true);
  assert.equal(normalizeConfig({ allow_gates: 'no' }).allowGates, false);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
