// -----------------------------------------------------------------------------
// The hub against fake Motion bridges: discovery, states, commands and the
// follow-up of a moving motor, the trigger, reachability, the token and the
// key, the mediated discovery and the persistence under /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_TEXT } from '../src/texts.js';
import {
  BRIDGE,
  FakeBridge,
  MACS,
  WIFI_CURTAIN,
  WIFI_GATE,
  createAll,
  createWorld,
  deviceId,
  discovered,
  featureId,
  lastState,
} from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

async function createdWorld(t, options) {
  const created = await world(t, options);
  await createAll(created);
  return created;
}

const setValue = (w, mac, key, value) =>
  w.fake.setValue(discovered(w, mac), { external_id: featureId(w.gladys, mac, key) }, value);

const writes = (bridge, mac, predicate = () => true) =>
  bridge.count('WriteDevice', (request) => request.mac === mac && predicate(request.data));

test('discovery: one device per blind, polled by the container and Gladys alike', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 8);
  const roller = discovered(w, MACS.roller);
  assert.equal(roller.name, 'Roller blind 0001');
  assert.equal(roller.model, 'Motionblinds Roller blind');
  assert.equal(roller.should_poll, true);
  assert.equal(roller.poll_frequency, 30_000);
  assert.deepEqual(roller.params, [
    { name: 'BRIDGE_IP', value: '192.0.2.20' },
    { name: 'MAC_ADDRESS', value: MACS.roller },
  ]);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing is sent for devices the user did not add.
  assert.equal(w.fake.states.length, 0);
});

test('states: published once the user adds the devices, then only the changes', async (t) => {
  const w = await createdWorld(t);
  assert.equal(lastState(w, MACS.roller, 'position'), 100);
  assert.equal(lastState(w, MACS.roller, 'battery'), 82);
  assert.equal(lastState(w, MACS.venetian, 'tilt'), 50);
  assert.equal(lastState(w, MACS.curtain, 'state'), 0);
  const count = w.fake.states.length;
  await w.poll();
  assert.equal(w.fake.states.length, count, 'no change, nothing sent');
  w.bridges[0].moveByRemote(MACS.curtain, { currentPosition: 100 });
  await w.poll();
  assert.equal(lastState(w, MACS.curtain, 'position'), 0);
  assert.equal(lastState(w, MACS.curtain, 'state'), -1);
  assert.equal(w.fake.states.length, count + 2);
});

test('the trigger fires when a blind moves without Gladys, with its direction', async (t) => {
  const w = await createdWorld(t);
  w.bridges[0].moveByRemote(MACS.roller, { currentPosition: 70 });
  await w.poll();
  assert.deepEqual(w.fake.sceneEvents.at(-1), {
    key: 'moved_outside_gladys',
    data: { device: deviceId(w.gladys, MACS.roller), direction: 'closing', position: 30 },
  });
  w.bridges[0].moveByRemote(MACS.roller, { currentPosition: 10 });
  await w.poll();
  assert.equal(w.fake.sceneEvents.at(-1).data.direction, 'opening');
});

test('a Gladys command: sent turned around, followed, and never "outside Gladys"', async (t) => {
  const w = await createdWorld(t);
  const ack = await setValue(w, MACS.roller, 'position', 25);
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    writes(w.bridges[0], MACS.roller, (data) => data.targetPosition === 75),
    1,
  );
  // The answer is the cache, before the motor moved: the follow-up reads it.
  const record = w.hub.records.get(MACS.roller);
  while (record.follow) {
    await w.hub.followUp(record);
  }
  assert.equal(lastState(w, MACS.roller, 'position'), 25);
  await w.poll();
  assert.equal(w.fake.sceneEvents.length, 0);
});

test('after a command the hub follows the motor until it stops', async (t) => {
  const w = await createdWorld(t);
  const bridge = w.bridges[0];
  bridge.instant = false;
  await setValue(w, MACS.curtain, 'state', -1);
  const record = w.hub.records.get(MACS.curtain);
  assert.ok(record.follow, 'following');
  let rounds = 0;
  while (record.follow && rounds < 20) {
    bridge.step();
    await w.hub.followUp(record);
    rounds += 1;
  }
  assert.equal(record.follow, null);
  assert.equal(lastState(w, MACS.curtain, 'position'), 0);
  assert.equal(lastState(w, MACS.curtain, 'state'), -1);
  // Radio status queries while it moved.
  assert.ok(writes(bridge, MACS.curtain, (data) => data.operation === 5) >= 3);
  assert.ok(rounds < 10, `${rounds} rounds`);
});

test('the slat tilt and the top rail are commands of their own', async (t) => {
  const w = await createdWorld(t);
  await setValue(w, MACS.venetian, 'tilt', 100);
  assert.equal(
    writes(w.bridges[0], MACS.venetian, (data) => data.targetAngle === 0),
    1,
  );
  await setValue(w, MACS.tdbu, 'top', 80);
  assert.equal(
    writes(w.bridges[0], MACS.tdbu, (data) => data.targetPosition_T === 20),
    1,
  );
  const refused = await setValue(w, MACS.tdbu, 'top', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /top rail cannot go below/);
});

test('a one-way motor: the command is shown as its state', async (t) => {
  const w = await createdWorld(t);
  await setValue(w, MACS.oneWay, 'state', 1);
  assert.equal(lastState(w, MACS.oneWay, 'state'), 1);
  assert.equal(w.hub.records.get(MACS.oneWay).follow, null);
});

test('a gate is never moved unless the configuration allows it', async (t) => {
  const w = await createdWorld(t);
  const refused = await setValue(w, MACS.gate, 'state', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /allow the gates/);
  assert.equal(writes(w.bridges[0], MACS.gate), 0);

  await w.fake.configUpdated({ ...w.fake.config, allow_gates: true });
  const gate = discovered(w, MACS.gate);
  assert.equal(
    gate.features.find((feature) => feature.external_id.endsWith(':state')).read_only,
    false,
  );
  const ack = await setValue(w, MACS.gate, 'state', 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    writes(w.bridges[0], MACS.gate, (data) => data.operation === 1),
    1,
  );
});

test('favorite position: the scene action', async (t) => {
  const w = await createdWorld(t);
  const ack = await w.fake.sceneAction('go_favorite', { device: deviceId(w.gladys, MACS.roller) });
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    writes(w.bridges[0], MACS.roller, (data) => data.operation === 12),
    1,
  );
  const gate = await w.fake.sceneAction('go_favorite', { device: deviceId(w.gladys, MACS.gate) });
  assert.equal(gate.success, false);
});

test('a bridge that stops answering: its blinds unreachable, then back', async (t) => {
  const w = await createdWorld(t);
  const bridge = w.bridges[0];
  bridge.online = false;
  await w.poll();
  await w.poll();
  const transport = (mac) =>
    w.fake.transports.findLast((entry) => entry.device_external_id === deviceId(w.gladys, mac))
      ?.transport;
  assert.equal(transport(MACS.roller), 'unreachable');
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.noAnswer,
  });
  const reads = bridge.count('ReadDevice');
  await w.poll();
  assert.equal(bridge.count('ReadDevice'), reads, 'no read per blind while the bridge is down');

  bridge.online = true;
  await w.poll();
  assert.equal(transport(MACS.roller), 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a renewed token is asked again, the read retried', async (t) => {
  const w = await createdWorld(t);
  const bridge = w.bridges[0];
  const lists = bridge.count('GetDeviceList');
  bridge.renewToken();
  bridge.moveByRemote(MACS.roller, { currentPosition: 50 });
  await w.poll();
  assert.equal(bridge.count('GetDeviceList'), lists + 1);
  assert.equal(lastState(w, MACS.roller, 'position'), 50);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a wrong key: said in the connection status and in the search report', async (t) => {
  const w = await world(t, { config: { key: 'aaaaaaaa-bbbb-cc' } });
  assert.equal(w.fake.discoveredDevices.length, 0, 'nothing can be read');
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.keyRejected,
  });
  const ack = await w.fake.action('search', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /refused the key/);
});

test('a missing or malformed key: said before anything is tried', async (t) => {
  const missing = await world(t, { config: { key: '' } });
  assert.deepEqual(missing.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.noKey,
  });
  const invalid = await world(t, { config: { key: 'short' } });
  assert.deepEqual(invalid.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.invalidKey,
  });
});

test('the search action lists the bridges and checks the key', async (t) => {
  const w = await createdWorld(t);
  const ack = await w.fake.action('search', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    '1 bridge(s), 1 answering: 192.0.2.20 (8 blind(s)). Key accepted.',
  );
  assert.match(ack.data.message.fr, /Clé acceptée/);
});

test('no address typed: the bridge found by the discovery through Gladys', async (t) => {
  const w = await world(t, { config: { hosts: '' }, scan: true });
  assert.equal(w.fake.discoveredDevices.length, 8);
  const [scan] = w.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, 32100);
  const payload = JSON.parse(Buffer.from(scan.payload_base64, 'base64').toString());
  assert.equal(payload.msgType, 'GetDeviceList');
});

test('no address and no discovery: the connection status asks for the address', async (t) => {
  const w = await world(t, { config: { hosts: '' }, scan: false });
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.noBridge,
  });
});

test('a restart with the bridge down publishes the same devices from /data', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const bridge = new FakeBridge(BRIDGE, '192.0.2.20');
  bridge.online = false;
  const second = await world(t, { bridges: [bridge], dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.discoveredDevices.map((device) => device.name),
    first.fake.discoveredDevices.map((device) => device.name),
  );
});

test('Wi-Fi motors: each one its own bridge; a Wi-Fi garage door locked', async (t) => {
  const w = await createdWorld(t, {
    bridges: [new FakeBridge(WIFI_CURTAIN, '192.0.2.30'), new FakeBridge(WIFI_GATE, '192.0.2.31')],
  });
  assert.equal(discovered(w, MACS.wifiCurtain).name, 'Curtain 1E2F');
  assert.equal(discovered(w, MACS.wifiGate).name, 'Garage door 3E4F');
  assert.equal(lastState(w, MACS.wifiCurtain, 'position'), 0);
  const refused = await setValue(w, MACS.wifiGate, 'state', 1);
  assert.equal(refused.success, false);
});

test('radio status queries: none at the start, then one every 15 minutes', async (t) => {
  const w = await createdWorld(t);
  const bridge = w.bridges[0];
  const queries = () => bridge.count('WriteDevice', (request) => request.data.operation === 5);
  assert.equal(queries(), 0);
  await w.poll();
  assert.equal(queries(), 0);
  w.clock.advance(15 * 60_000);
  await w.poll();
  // Every two-way motor of the bridge but the one-way one (and the TDBU,
  // queried on both rails).
  assert.equal(queries() + bridge.count('WriteDevice', (r) => r.data.operation_B === 5), 7);
});

test('Gladys polling as well: a blind the timer just read is skipped', async (t) => {
  const w = await createdWorld(t);
  const bridge = w.bridges[0];
  const reads = bridge.count('ReadDevice');
  await w.fake.poll(discovered(w, MACS.roller));
  assert.equal(bridge.count('ReadDevice'), reads);
  w.clock.advance(20_000);
  await w.fake.poll(discovered(w, MACS.roller));
  assert.equal(bridge.count('ReadDevice'), reads + 1);
});

test('a device added later gets its states again', async (t) => {
  const w = await createdWorld(t);
  const id = featureId(w.gladys, MACS.roller, 'position');
  const before = w.fake.states.filter((state) => state.device_feature_external_id === id).length;
  await w.fake.deviceUpdated(discovered(w, MACS.roller));
  await w.hub.idle();
  const after = w.fake.states.filter((state) => state.device_feature_external_id === id).length;
  assert.equal(after, before + 1);
});

test('the names follow the language of the configuration', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  assert.equal(discovered(w, MACS.venetian).name, 'Store vénitien 0002');
  await w.fake.configUpdated({ ...w.fake.config, language: 'de' });
  assert.equal(discovered(w, MACS.venetian).name, 'Jalousie 0002');
  assert.ok(discovered(w, MACS.venetian).features.some((f) => f.name === 'Lamellenneigung'));
});

test('unchanged values are sent again after the heartbeat delay', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const w = await createdWorld(t);
  const id = featureId(w.gladys, MACS.roller, 'battery');
  const count = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === id).length;
  const before = count();
  await w.poll();
  assert.equal(count(), before);
  t.mock.timers.tick(6 * 3_600_000 + 1);
  await w.poll();
  assert.equal(count(), before + 1);
});
