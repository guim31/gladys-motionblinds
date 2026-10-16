// -----------------------------------------------------------------------------
// Finding the Motion bridges without their address: a discovery request the
// Gladys core broadcasts for the integration.
//
// The Motion app finds the bridges with a GetDeviceList sent to the multicast
// group 238.0.0.18, port 32100. The integration container sits on a Docker
// bridge network: neither multicast nor broadcast crosses it, in either
// direction. So the core broadcasts the same GetDeviceList on port 32100
// (mediated `udp-active-broadcast` discovery, port declared in the manifest
// `network_discovery`) and relays the answers that come back in unicast. A
// bridge that only answers the multicast group stays silent there: its address
// is then typed in the configuration, which always works.
// -----------------------------------------------------------------------------

import { MOTION_PORT, getDeviceListRequest, parseDeviceList } from './motion/protocol.js';

export const SCAN_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The broadcast request of a discovery scan (`scanNetwork` options). */
export function scanRequest(date) {
  return {
    port: MOTION_PORT,
    payload: Buffer.from(JSON.stringify(getDeviceListRequest(date))),
    timeoutSeconds: SCAN_TIMEOUT_SECONDS,
  };
}

/**
 * Bridges (and Wi-Fi motors) that answered a discovery scan:
 * `[{ host, mac, deviceType }]`, one per MAC.
 * @param {Array} replies raw results `[{ source_ip, source_port, payload_base64 }]`
 */
export function parseScanReplies(replies) {
  const found = new Map();
  for (const reply of Array.isArray(replies) ? replies : []) {
    if (!reply || typeof reply.source_ip !== 'string' || !IPV4.test(reply.source_ip)) {
      continue;
    }
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(String(reply.payload_base64 ?? ''), 'base64').toString());
    } catch {
      continue;
    }
    const list = parseDeviceList(decoded);
    if (list && !found.has(list.mac)) {
      found.set(list.mac, { host: reply.source_ip, mac: list.mac, deviceType: list.deviceType });
    }
  }
  return [...found.values()];
}
