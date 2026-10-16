// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Motion bridges on a fake
// UDP network, and a temporary /data, with the integration wired on top
// through registerHandlers. No timer runs unless asked: the tests read the
// blinds with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FIXTURE_NAMES, FakeBridge, TEST_KEY, createNetwork } from './fakeBridge.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast retries: a bridge that does not answer fails in 60 ms.
export const FAST_TRANSPORT = { timeoutMs: 60, retryMs: 20, continuationMs: 20 };

export const BRIDGE = 'bridge-cm20-eight-blinds';
export const WIFI_CURTAIN = 'wifi-curtain-motor';
export const WIFI_GATE = 'wifi-garage-door';

const GW = '0a0b0c0d0e0f';
// The blinds of the BRIDGE fixture.
export const MACS = {
  roller: `${GW}0001`,
  venetian: `${GW}0002`,
  curtain: `${GW}0003`,
  oneWay: `${GW}0004`,
  gate: `${GW}0005`,
  tdbu: `${GW}0006`,
  doubleRoller: `${GW}0007`,
  limits: `${GW}0008`,
  wifiCurtain: '0a0b0c0d1e2f',
  wifiGate: '0a0b0c0d3e4f',
};

/** One fake bridge per fixture, at 192.0.2.20, .21... */
export function allBridges() {
  return FIXTURE_NAMES.map((name, index) => new FakeBridge(name, `192.0.2.${20 + index}`));
}

/**
 * @param {object} [options]
 * @param {FakeBridge[]} [options.bridges] the fake bridges of the network
 * @param {boolean} [options.scan] whether the core's discovery finds them
 * @param {object} [options.config] raw integration config (hosts default to the bridges')
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's own timers (off: the tests poll)
 */
export async function createWorld({
  bridges = [new FakeBridge(BRIDGE, '192.0.2.20')],
  scan = false,
  config = {},
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-motionblinds-')),
  timings = {},
  timers = false,
  clock = createClock(),
} = {}) {
  const network = createNetwork(bridges);
  const gladys = createFakeGladys({
    config: {
      hosts: bridges.map((bridge) => bridge.host).join(', '),
      key: TEST_KEY,
      language: 'en',
      ...config,
    },
    devices: created,
    scanResults: { 'udp-active-broadcast': scan ? network.scanReplies() : [] },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    createSocket: network.createSocket,
    timers,
    timings,
    transportTimings: FAST_TRANSPORT,
    now: () => clock.time,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  /** One cycle of the hub's timer, one period after the previous one. */
  const poll = async () => {
    clock.advance(app.hub.config.pollSeconds * 1000);
    await app.hub.pollAll();
    await app.hub.idle();
  };
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, dataDir, bridges, clock, poll };
}

/** The hub's clock in the tests: it only moves when told. */
export function createClock(start = Date.parse('2026-10-16T08:00:00Z')) {
  const clock = {
    time: start,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const deviceId = (gladys, mac) => gladys.externalIds('blind', mac).device;
export const featureId = (gladys, mac, key) => gladys.externalIds('blind', mac).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

/** The discovered device of a blind. */
export const discovered = (world, mac) =>
  world.fake.discoveredDevices.find((device) => device.external_id === deviceId(world.gladys, mac));

export const lastState = (world, mac, key) =>
  world.fake.lastState(featureId(world.gladys, mac, key));

export { FakeBridge, TEST_KEY };
