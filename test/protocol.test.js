// -----------------------------------------------------------------------------
// The Motion protocol: message ids, the AccessToken, and the parsing of the
// bridge's answers (test/fixtures/motion).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessToken,
  batteryLevel,
  getDeviceListRequest,
  isValidKey,
  messageId,
  normalizeMac,
  parseBlindState,
  parseDeviceList,
  readDeviceRequest,
  writeDeviceRequest,
} from '../src/motion/protocol.js';
import { loadFixture } from './helpers/fakeBridge.js';
import { MACS } from './helpers/world.js';

const bridge = loadFixture('bridge-cm20-eight-blinds');
const state = (mac) => parseBlindState(bridge.devices[mac]);

test('msgID is the UTC time as YYYYMMDDHHMMSSmmm', () => {
  assert.equal(messageId(new Date('2026-10-16T06:15:00.123Z')), '20261016061500123');
  assert.deepEqual(getDeviceListRequest(new Date('2026-01-02T03:04:05.006Z')), {
    msgType: 'GetDeviceList',
    msgID: '20260102030405006',
  });
});

test('the AccessToken is the token encrypted with the key, AES-128-ECB, upper-case hex', () => {
  // Cross-checked with: printf 12345A678B9CDEFG | openssl enc -aes-128-ecb -nopad -K <hex of the key>
  assert.equal(
    accessToken('12ab345c-d67e-8f', '12345A678B9CDEFG'),
    'D8D9957F7AA89E779C1F3829E0F1AD79',
  );
  assert.throws(() => accessToken('too-short', '12345A678B9CDEFG'), /16 characters/);
  assert.throws(() => accessToken('12ab345c-d67e-8f', 'short'), /unexpected length/);
  assert.equal(isValidKey('12ab345c-d67e-8f'), true);
  assert.equal(isValidKey('12ab345c-d67e-8'), false);
});

test('ReadDevice and WriteDevice carry the MAC, the type and the AccessToken', () => {
  const date = new Date('2026-10-16T06:15:00.123Z');
  const blind = { mac: MACS.roller, deviceType: '10000000', token: '12345A678B9CDEFG' };
  const key = '12ab345c-d67e-8f';
  assert.deepEqual(readDeviceRequest({ ...blind, key }, date), {
    msgType: 'ReadDevice',
    mac: MACS.roller,
    deviceType: '10000000',
    AccessToken: 'D8D9957F7AA89E779C1F3829E0F1AD79',
    msgID: '20261016061500123',
  });
  assert.deepEqual(writeDeviceRequest({ ...blind, key }, { operation: 1 }, date).data, {
    operation: 1,
  });
});

test('a device list: the bridge, its token and its blinds, the bridge itself left out', () => {
  const list = parseDeviceList(bridge.deviceList);
  assert.equal(list.mac, '0a0b0c0d0e0f');
  assert.equal(list.deviceType, '02000002');
  assert.equal(list.token, '12345A678B9CDEFG');
  assert.equal(list.protocol, '0.9');
  assert.equal(list.firmware, 'A1.1.1_B0.1.2');
  assert.equal(list.blinds.length, 8);
  assert.ok(list.blinds.every((blind) => blind.mac !== list.mac));
  assert.equal(parseDeviceList({ msgType: 'Heartbeat' }), null);
  assert.equal(parseDeviceList({ ...bridge.deviceList, deviceType: '10000000' }), null);
});

test('a device list in several datagrams is merged, the last token wins', () => {
  const { data, ...head } = bridge.deviceList;
  const list = parseDeviceList([
    { ...head, data: data.slice(0, 4) },
    { ...head, token: 'NEWTOKEN12345678', data: data.slice(4) },
  ]);
  assert.equal(list.blinds.length, 8);
  assert.equal(list.token, 'NEWTOKEN12345678');
});

test('MAC addresses are lower-case, without separators', () => {
  assert.equal(normalizeMac('AB:BB:CC:DD:EE:FF'), 'abbbccddeeff');
  assert.equal(normalizeMac('0A0B0C0D0E0F0001'), '0a0b0c0d0e0f0001');
  assert.equal(normalizeMac('nope'), null);
});

test('battery level from the pack voltage, like the motionblinds library', () => {
  assert.equal(batteryLevel(11.95), 81); // 3 cells, the library README sample
  assert.equal(batteryLevel(8.4), 100); // 2 cells, full
  assert.equal(batteryLevel(14.6), 0); // 4 cells, empty
  assert.equal(batteryLevel(12.6), 100); // capped
  assert.equal(batteryLevel(0), 0);
  assert.equal(batteryLevel(227.35), null); // mains motor
  assert.equal(batteryLevel(null), null);
});

test('a battery roller blind: position, battery, charge, signal', () => {
  assert.deepEqual(state(MACS.roller), {
    deviceType: '10000000',
    blindType: 1,
    wirelessMode: 1,
    voltageMode: 1,
    operation: 2,
    position: 0,
    angle: 0,
    top: null,
    batteryVolts: 11.97,
    battery: 82,
    charging: false,
    rssi: -71,
  });
});

test('a mains motor has no battery, a venetian blind an angle', () => {
  const venetian = state(MACS.venetian);
  assert.equal(venetian.battery, null);
  assert.equal(venetian.angle, 90);
  assert.equal(venetian.position, 100);
});

test('a double roller counts its angle in 0-90: scaled to 0-180', () => {
  assert.equal(state(MACS.doubleRoller).angle, 90);
});

test('a one-way motor tells nothing but its type', () => {
  const oneWay = state(MACS.oneWay);
  assert.equal(oneWay.wirelessMode, 0);
  assert.equal(oneWay.position, null);
  assert.equal(oneWay.rssi, null);
  assert.equal(oneWay.battery, null);
});

test('a limits-only motor has no position', () => {
  const limits = state(MACS.limits);
  assert.equal(limits.position, null);
  assert.equal(limits.battery, 85);
});

test('a top-down bottom-up blind: the bottom rail, the top rail, the lower battery', () => {
  const tdbu = state(MACS.tdbu);
  assert.equal(tdbu.position, 60);
  assert.equal(tdbu.top, 0);
  assert.equal(tdbu.batteryVolts, 11.21);
  assert.equal(tdbu.battery, 45);
});

test('a virtual-percentage motor without both limits has no position yet', () => {
  const reply = {
    msgType: 'ReadDeviceAck',
    deviceType: '10000000',
    data: { type: 1, wirelessMode: 4, currentState: 1, currentPosition: 30, operation: 2 },
  };
  assert.equal(parseBlindState(reply).position, null);
  reply.data.currentState = 3;
  assert.equal(parseBlindState(reply).position, 30);
});

test('an error answer holds no state', () => {
  assert.equal(
    parseBlindState({ msgType: 'ReadDeviceAck', actionResult: 'AccessToken error' }),
    null,
  );
  assert.equal(parseBlindState({ msgType: 'ReadDeviceAck' }), null);
});
