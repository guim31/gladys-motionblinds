// -----------------------------------------------------------------------------
// From a blind to a Gladys device: what each kind of motor gets, the positions
// turned around (Gladys: 100 = open), and the WriteDevice data of each command.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_STATE,
  CommandError,
  FEATURE_KEYS,
  angleFromTilt,
  capabilitiesOf,
  commandFor,
  coverState,
  deviceValues,
  featureSpecs,
  tiltFromAngle,
  toGladys,
  toMotor,
} from '../src/devices.js';

const profile = (overrides) => ({
  deviceType: '10000000',
  blindType: 1,
  wirelessMode: 1,
  battery: false,
  charging: false,
  signal: true,
  ...overrides,
});
const config = { language: 'en', allowGates: false };
const keys = (caps, cfg = config) => featureSpecs(caps, cfg).map((spec) => spec.key);

test('positions: the motor counts 0 = open, Gladys 100 = open', () => {
  assert.equal(toGladys(0), 100);
  assert.equal(toGladys(100), 0);
  assert.equal(toGladys(null), null);
  assert.equal(toMotor(100), 0);
  assert.equal(toMotor(25), 75);
  assert.equal(toMotor(140), 0);
  assert.equal(toMotor(-5), 100);
});

test('slat tilt: 100 % = slats open (angle 0), 0 % = closed (angle 180)', () => {
  assert.equal(tiltFromAngle(0), 100);
  assert.equal(tiltFromAngle(180), 0);
  assert.equal(tiltFromAngle(90), 50);
  assert.equal(angleFromTilt(100), 0);
  assert.equal(angleFromTilt(0), 180);
});

test('a roller blind: open / close / stop and its position, a curtain in its category', () => {
  const caps = capabilitiesOf(profile({}));
  assert.equal(caps.kind, 'shutter');
  assert.deepEqual(keys(caps), [FEATURE_KEYS.STATE, FEATURE_KEYS.POSITION, FEATURE_KEYS.SIGNAL]);
  const curtain = capabilitiesOf(profile({ blindType: 12 }));
  assert.equal(curtain.kind, 'curtain');
  assert.deepEqual(
    featureSpecs(curtain, config).map((spec) => `${spec.category}/${spec.type}`),
    ['curtain/state', 'curtain/position', 'signal/integer'],
  );
  assert.equal(
    capabilitiesOf(profile({ deviceType: '22000000', blindType: null })).kind,
    'curtain',
  );
});

test('tilting blinds get a slat slider, a top-down bottom-up blind its top rail', () => {
  for (const blindType of [2, 5, 15, 17, 21, 27, 28, 29]) {
    assert.ok(keys(capabilitiesOf(profile({ blindType }))).includes('tilt'), `type ${blindType}`);
  }
  assert.ok(!keys(capabilitiesOf(profile({ blindType: 1 }))).includes('tilt'));
  assert.deepEqual(keys(capabilitiesOf(profile({ deviceType: '10000001', blindType: 9 }))), [
    'state',
    'position',
    'top',
    'signal',
  ]);
});

test('a one-way motor and a limits-only motor: no position, no sensor', () => {
  assert.deepEqual(keys(capabilitiesOf(profile({ wirelessMode: 0, signal: true }))), ['state']);
  assert.deepEqual(keys(capabilitiesOf(profile({ wirelessMode: 2, battery: true }))), [
    'state',
    'battery',
    'signal',
  ]);
  const oneWay = featureSpecs(capabilitiesOf(profile({ wirelessMode: 0 })), config);
  assert.equal(oneWay[0].feedback, false);
});

test('a battery motor: its level, and its charge when it reports one', () => {
  assert.deepEqual(keys(capabilitiesOf(profile({ battery: true, charging: true }))), [
    'state',
    'position',
    'battery',
    'charging',
    'signal',
  ]);
});

test('garage doors and gates are read-only unless the configuration allows them', () => {
  for (const caps of [
    capabilitiesOf(profile({ blindType: 7 })),
    capabilitiesOf(profile({ deviceType: '22000005', blindType: 7, wirelessMode: 3 })),
  ]) {
    assert.equal(caps.gate, true);
    const locked = featureSpecs(caps, config).filter((spec) => !spec.key.startsWith('signal'));
    assert.ok(locked.every((spec) => spec.read_only === true));
    const allowed = featureSpecs(caps, { ...config, allowGates: true });
    assert.ok(allowed.filter((spec) => spec.key === 'state')[0].read_only === false);
  }
  assert.equal(capabilitiesOf(profile({ deviceType: '22000005' })).typeKey, 'garageDoor');
});

test('an unknown blind type is driven like a roller blind', () => {
  const caps = capabilitiesOf(profile({ blindType: 99 }));
  assert.equal(caps.typeKey, '1');
  assert.equal(caps.kind, 'shutter');
});

test('open / close / stop: the direction while running, the ends, stopped in between', () => {
  assert.equal(coverState({ operation: 1, position: 50 }), COVER_STATE.OPEN);
  assert.equal(coverState({ operation: 0, position: 50 }), COVER_STATE.CLOSE);
  assert.equal(coverState({ operation: 2, position: 0 }), COVER_STATE.OPEN);
  assert.equal(coverState({ operation: 2, position: 100 }), COVER_STATE.CLOSE);
  assert.equal(coverState({ operation: 2, position: 40 }), COVER_STATE.STOP);
  assert.equal(coverState({ operation: 2, position: null }), null);
});

test('a one-way motor shows the last command Gladys sent', () => {
  const record = {
    caps: capabilitiesOf(profile({ wirelessMode: 0 })),
    state: { operation: 2, position: null },
    assumedState: COVER_STATE.CLOSE,
  };
  assert.deepEqual(deviceValues(record), { state: COVER_STATE.CLOSE });
});

const record = (overrides, state = {}) => ({
  caps: capabilitiesOf(profile(overrides)),
  state: { position: 50, top: 0, angle: 0, ...state },
  restoreAngle: null,
});

test('commands: open, close, stop', () => {
  const roller = record({});
  assert.deepEqual(commandFor(roller, 'state', 1), { data: { operation: 1 }, target: 0 });
  assert.deepEqual(commandFor(roller, 'state', -1), { data: { operation: 0 }, target: 100 });
  assert.deepEqual(commandFor(roller, 'state', 0), { data: { operation: 2 }, target: null });
  const tdbu = record({ deviceType: '10000001', blindType: 9 });
  assert.deepEqual(commandFor(tdbu, 'state', 1).data, { targetPosition_B: 0, targetPosition_T: 0 });
  assert.deepEqual(commandFor(tdbu, 'state', 0).data, { operation_B: 2, operation_T: 2 });
});

test('commands: a position is sent turned around, a tilting blind keeps its slats', () => {
  assert.deepEqual(commandFor(record({}), 'position', 70), {
    data: { targetPosition: 30 },
    target: 30,
  });
  const venetian = { ...record({ blindType: 2 }), restoreAngle: 90 };
  assert.deepEqual(commandFor(venetian, 'position', 70).data, {
    targetPosition: 30,
    targetAngle: 90,
  });
  // Fully open (motor 0): the slats are not sent.
  assert.deepEqual(commandFor(venetian, 'position', 100).data, { targetPosition: 0 });
});

test('commands: the slat tilt, scaled to the motor (0-90 for a Shangri-La)', () => {
  assert.deepEqual(commandFor(record({ blindType: 2 }), 'tilt', 100).data, { targetAngle: 0 });
  assert.deepEqual(commandFor(record({ blindType: 2 }), 'tilt', 0).data, { targetAngle: 180 });
  assert.deepEqual(commandFor(record({ blindType: 5 }), 'tilt', 50).data, { targetAngle: 45 });
});

test('commands: the rails of a top-down bottom-up blind cannot cross', () => {
  const tdbu = record({ deviceType: '10000001', blindType: 9 }, { position: 60, top: 20 });
  assert.deepEqual(commandFor(tdbu, 'position', 10).data, { targetPosition_B: 90 });
  assert.deepEqual(commandFor(tdbu, 'top', 100).data, { targetPosition_T: 0 });
  assert.throws(() => commandFor(tdbu, 'position', 90), /cannot go above/);
  assert.throws(() => commandFor(tdbu, 'top', 10), /cannot go below/);
});

test('commands: a feature that cannot be controlled, a value that is not a number', () => {
  assert.throws(() => commandFor(record({}), 'battery', 50), CommandError);
  assert.throws(() => commandFor(record({}), 'tilt', 50), CommandError);
  assert.throws(() => commandFor(record({}), 'position', 'up'), /Invalid value/);
});
