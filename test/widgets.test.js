// -----------------------------------------------------------------------------
// The `blinds` widget: every blind added to Gladys on one card, within the
// core's budget, and the open / stop / close buttons for all of them — never
// a garage door or a gate.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TEXT } from '../src/widgets.js';
import { BRIDGE, FakeBridge, MACS, createAll, createWorld } from './helpers/world.js';

async function createdWorld(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const get = async (w, language = 'en') => {
  const ack = await w.fake.widgetGet('blinds', { settings: {}, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content ?? ack.data;
};

test('before any blind is added, the widget says how to add them', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const content = await get(w, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, TEXT.empty.fr);
});

test('one row per blind, within the budget, with the three buttons', async (t) => {
  const w = await createdWorld(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const content = await get(w, language);
    assert.deepEqual(validateWidgetContent(content), [], language);
    const status = content.components.find((component) => component.type === 'status');
    assert.equal(status.items.length, 8);
    const buttons = content.components.filter((component) => component.type === 'button');
    assert.deepEqual(
      buttons.map((button) => button.action.key),
      ['open_all', 'stop_all', 'close_all'],
    );
  }
  const content = await get(w);
  assert.equal(content.components[0].text, 'Motionblinds · 8 blinds · 8 answering');
  const row = (name) => content.components[1].items.find((item) => item.label.startsWith(name));
  assert.equal(row('Roller blind').value, '100 %');
  assert.equal(row('Roller shutter').value, '—');
});

test('rows show a low battery and a bridge that does not answer', async (t) => {
  const w = await createdWorld(t);
  w.bridges[0].moveByRemote(MACS.roller, { batteryLevel: 1050 });
  await w.poll();
  let content = await get(w);
  const roller = content.components[1].items.find((item) => item.label.startsWith('Roller blind'));
  assert.equal(roller.value, '100 % · battery 11 %');
  assert.equal(roller.color, 'warning');

  w.bridges[0].online = false;
  await w.poll();
  await w.poll();
  content = await get(w);
  assert.ok(content.components[1].items.every((item) => item.value === 'not answering'));
});

test('the rows use the names the user gave in Gladys', async (t) => {
  const w = await createdWorld(t);
  const device = w.fake.devices.find((entry) => entry.external_id.endsWith(MACS.curtain));
  await w.fake.deviceUpdated({ ...device, name: 'Living room curtain' });
  const content = await get(w);
  assert.ok(content.components[1].items.some((item) => item.label === 'Living room curtain'));
});

test('close all: every blind but the gate, and a toast', async (t) => {
  const w = await createdWorld(t);
  const ack = await w.fake.widgetAction('blinds', 'close_all', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, '7 blind(s) closing');
  const bridge = w.bridges[0];
  const moved = (mac) =>
    bridge.count(
      'WriteDevice',
      (request) =>
        request.mac === mac &&
        (request.data.operation === 0 || request.data.targetPosition_B === 100),
    );
  assert.equal(moved(MACS.gate), 0);
  for (const mac of [MACS.roller, MACS.curtain, MACS.oneWay, MACS.tdbu, MACS.limits]) {
    assert.equal(moved(mac), 1, mac);
  }
  // Even when gates are allowed.
  await w.fake.configUpdated({ ...w.fake.config, allow_gates: true });
  await w.fake.widgetAction('blinds', 'close_all', {}, { settings: {} });
  assert.equal(moved(MACS.gate), 0);
});

test('nothing reachable: the toast says so', async (t) => {
  const w = await createdWorld(t);
  w.bridges[0].online = false;
  await w.poll();
  await w.poll();
  const ack = await w.fake.widgetAction('blinds', 'stop_all', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.message, TEXT.none);
});

test('more than ten blinds: nine rows and the count of the others', async (t) => {
  const bridges = [0, 1].map((index) => {
    const bridge = new FakeBridge(BRIDGE, `192.0.2.${20 + index}`);
    if (index === 1) {
      // A second bridge: same fixture, other MACs.
      const rename = (mac) => mac.replace('0a0b0c0d0e0f', '0a0b0c0d0e1f');
      bridge.fixture = JSON.parse(
        JSON.stringify(bridge.fixture).replaceAll('0a0b0c0d0e0f', '0a0b0c0d0e1f'),
      );
      bridge.mac = rename(bridge.mac);
      bridge.cache = new Map(
        [...bridge.cache].map(([mac, ack]) => [rename(mac), { ...ack, mac: rename(mac) }]),
      );
      bridge.motors = new Map([...bridge.motors].map(([mac, data]) => [rename(mac), data]));
    }
    return bridge;
  });
  const w = await createdWorld(t, { bridges });
  const content = await get(w);
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components[1].items;
  assert.equal(items.length, 10);
  assert.deepEqual(items.at(-1), {
    label: 'Others',
    icon: 'more-horizontal',
    value: 7,
    color: 'neutral',
  });
});
