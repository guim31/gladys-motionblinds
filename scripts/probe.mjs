#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Motion bridge (or Motion Wi-Fi motor), with the
// integration's own client: GetDeviceList, then the cached state of each blind
// (ReadDevice: no radio traffic, nothing moves). No WriteDevice is ever sent.
//
//   node scripts/probe.mjs <bridge IP> <key of the Motion app> [--raw]
//
// Prints what the integration would publish for each blind. `--raw` also prints
// the bridge's answers, anonymized, ready to become a test fixture
// (test/fixtures/motion). Never printed: the key, the token, the AccessToken,
// the real MAC addresses (only their last 4 characters).
// -----------------------------------------------------------------------------

import { capabilitiesOf, deviceValues, featureSpecs, NAMES } from '../src/devices.js';
import { MotionBridge } from '../src/motion/bridge.js';
import { isValidKey, parseBlindState } from '../src/motion/protocol.js';
import { MotionTransport } from '../src/motion/transport.js';

const [host, key, ...flags] = process.argv.slice(2);
const raw = flags.includes('--raw');

if (!host || !key) {
  console.error('Usage: node scripts/probe.mjs <bridge IP> <key of the Motion app> [--raw]');
  process.exit(2);
}
if (!isValidKey(key)) {
  console.error('The key must have 16 characters, dashes included.');
  process.exit(2);
}

// Real MACs become invented ones: the bridge 0a0b0c0d0e0f, its blinds the same
// followed by their own last 4 characters (as on a real bridge).
let bridgeMac = null;
const anonymize = (mac) => {
  if (typeof mac !== 'string') {
    return mac;
  }
  if (bridgeMac && mac === bridgeMac) {
    return '0a0b0c0d0e0f';
  }
  if (bridgeMac && mac.startsWith(bridgeMac)) {
    return `0a0b0c0d0e0f${mac.slice(bridgeMac.length)}`;
  }
  return `0a0b0c0d${mac.slice(-4)}`;
};
const clean = (message) =>
  JSON.parse(
    JSON.stringify(message, (field, value) => {
      if (field === 'token' || field === 'AccessToken') {
        return '<hidden>';
      }
      if (field === 'mac') {
        return anonymize(value);
      }
      return value;
    }),
  );

const transport = new MotionTransport();
const bridge = new MotionBridge({ host, transport, getKey: () => key });

try {
  const list = await bridge.getDeviceList();
  bridgeMac = list.mac;
  console.log(
    `Bridge …${list.mac.slice(-4)} at ${host}: type ${list.deviceType}, protocol ${list.protocol ?? '?'}, firmware ${list.firmware ?? '?'}, ${list.blinds.length} blind(s)`,
  );
  const fixture = { deviceList: null, devices: {} };
  if (raw) {
    const replies = await transport.request(
      host,
      { msgType: 'GetDeviceList', msgID: '0' },
      { multiple: true },
    );
    fixture.deviceList = clean(replies[0]);
  }
  for (const blind of list.blinds) {
    try {
      const { reply } = await bridge.read(blind);
      const state = parseBlindState(reply);
      if (raw) {
        fixture.devices[anonymize(blind.mac)] = clean(reply);
      }
      if (!state) {
        console.log(`- …${blind.mac.slice(-4)} (${blind.deviceType}): no state in the answer`);
        continue;
      }
      const profile = {
        deviceType: blind.deviceType,
        blindType: state.blindType,
        wirelessMode: state.wirelessMode,
        battery: state.battery !== null,
        charging: state.charging !== null,
        signal: state.rssi !== null,
      };
      const caps = capabilitiesOf(profile);
      const values = deviceValues({ caps, state, assumedState: null });
      const config = { language: 'en', allowGates: false };
      const features = featureSpecs(caps, config)
        .map((spec) => `${spec.name}=${values[spec.key] ?? '?'}`)
        .join(', ');
      console.log(
        `- …${blind.mac.slice(-4)} ${NAMES.en[caps.typeKey] ?? 'Blind'} (device ${blind.deviceType}, type ${state.blindType}, radio ${state.wirelessMode}): ${features}`,
      );
    } catch (err) {
      const hint = err.keyRejected ? ' (the key is refused)' : '';
      console.log(`- …${blind.mac.slice(-4)} (${blind.deviceType}): ${err.message}${hint}`);
    }
  }
  if (raw) {
    console.log(JSON.stringify(fixture, null, 2));
  }
} catch (err) {
  console.error(`No Motion answer from ${host}: ${err.message}`);
  process.exitCode = 1;
} finally {
  transport.close();
}
