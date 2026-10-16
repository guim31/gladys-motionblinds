// -----------------------------------------------------------------------------
// The local protocol of the Motion Wi-Fi bridges (CM-20, CM-32...) and of the
// Motion Wi-Fi motors: JSON datagrams on UDP port 32100, one request, one
// reply (a long device list may come in several datagrams).
//
//   GetDeviceList → GetDeviceListAck: the bridge MAC, its type, a 16-character
//                   `token` and the list of its blinds (MAC + device type).
//   ReadDevice    → ReadDeviceAck: the state the bridge keeps in cache for a
//                   blind (no radio traffic).
//   WriteDevice   → WriteDeviceAck: a command (`data`), answered with the
//                   cached state. `{ operation: 5 }` asks the blind for its
//                   state over the radio; the new state reaches the cache.
//
// ReadDevice and WriteDevice carry an `AccessToken`: the token encrypted with
// AES-128-ECB under the 16-character key shown by the Motion app, in upper-case
// hexadecimal. A wrong key is answered with an `actionResult` error.
//
// Positions are the motor's: 0 = open (up), 100 = closed (down); angles are
// 0-180 degrees, 0 = slats open. The conversion to Gladys (100 = open) is done
// in src/devices.js. Based on the motionblinds library (starkillerOG, MIT) and
// the Home Assistant integration (Apache-2.0).
// -----------------------------------------------------------------------------

import { createCipheriv } from 'node:crypto';

export const MOTION_PORT = 32100;
export const KEY_LENGTH = 16;
// A datagram this long may be followed by the rest of the answer.
export const MAX_DATAGRAM = 1024;

export const MSG = {
  GET_DEVICE_LIST: 'GetDeviceList',
  READ_DEVICE: 'ReadDevice',
  WRITE_DEVICE: 'WriteDevice',
};

export const DEVICE_TYPES = {
  BRIDGE: ['02000001', '02000002'],
  BLIND: '10000000',
  TDBU: '10000001',
  DOUBLE_ROLLER: '10000002',
  SUNBLIND: '10000011',
  WIFI_CURTAIN: '22000000',
  WIFI_BLIND: '22000002',
  WIFI_GATE: '22000005',
};
export const WIFI_DEVICE_TYPES = [
  DEVICE_TYPES.WIFI_CURTAIN,
  DEVICE_TYPES.WIFI_BLIND,
  DEVICE_TYPES.WIFI_GATE,
];
/** Device types that answer GetDeviceList: a bridge, or a Wi-Fi motor. */
export const CONTROLLER_TYPES = [...DEVICE_TYPES.BRIDGE, ...WIFI_DEVICE_TYPES];
export const BLIND_DEVICE_TYPES = [
  DEVICE_TYPES.BLIND,
  DEVICE_TYPES.TDBU,
  DEVICE_TYPES.DOUBLE_ROLLER,
  DEVICE_TYPES.SUNBLIND,
  ...WIFI_DEVICE_TYPES,
];

/** `data.type` of a blind: what the motor drives (set in the Motion app). */
export const BLIND_TYPES = {
  ROLLER_BLIND: 1,
  VENETIAN_BLIND: 2,
  ROMAN_BLIND: 3,
  HONEYCOMB_BLIND: 4,
  SHANGRI_LA_BLIND: 5,
  ROLLER_SHUTTER: 6,
  ROLLER_GATE: 7,
  AWNING: 8,
  TOP_DOWN_BOTTOM_UP: 9,
  DAY_NIGHT_BLIND: 10,
  DIMMING_BLIND: 11,
  CURTAIN: 12,
  CURTAIN_LEFT: 13,
  CURTAIN_RIGHT: 14,
  ROLLER_TILT_MOTOR: 15,
  DOUBLE_ROLLER: 17,
  VERTICAL_BLIND_LEFT: 21,
  WOOD_SHUTTER: 22,
  RADIO_RECEIVER: 24,
  SKYLIGHT_BLIND: 26,
  DUAL_SHADE: 27,
  VERTICAL_BLIND: 28,
  VERTICAL_BLIND_RIGHT: 29,
  WOVEN_WOOD_SHADES: 40,
  SWITCH: 43,
  INSECT_SCREEN: 44,
  TRIANGLE_BLIND: 57,
};
export const KNOWN_BLIND_TYPES = Object.values(BLIND_TYPES);

/** `data.operation`: what the motor does, and the operations it accepts. */
export const OPERATION = {
  CLOSE: 0,
  OPEN: 1,
  STOP: 2,
  QUERY: 5,
  JOG_UP: 7,
  JOG_DOWN: 8,
  GO_FAVORITE: 12,
};

/** `data.wirelessMode`: how much the motor tells about itself. */
export const WIRELESS_MODE = {
  // One-way radio: commands only, no state at all.
  UNI_DIRECTION: 0,
  BI_DIRECTION: 1,
  // Two-way, but the motor only knows its end limits, not a percentage.
  BI_DIRECTION_LIMITS: 2,
  WIFI: 3,
  // A percentage once both end limits are set.
  VIRTUAL_PERCENTAGE_LIMITS: 4,
  OTHERS: 5,
};

export const VOLTAGE_MODE = { AC: 0, DC: 1 };

// `data.currentState` of a virtual-percentage motor: both limits are set.
const BOTH_LIMITS = 3;

/** `msgID`: the UTC time, YYYYMMDDHHMMSSmmm, like the Motion app sends. */
export function messageId(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 17);
}

/** A 16-character key, as the Motion app shows it (with its dashes). */
export const isValidKey = (key) =>
  typeof key === 'string' && Buffer.byteLength(key, 'utf8') === KEY_LENGTH;

/**
 * The AccessToken of the ReadDevice and WriteDevice requests.
 * @param {string} key the 16-character key of the Motion app
 * @param {string} token the 16-character token of the last GetDeviceListAck
 */
export function accessToken(key, token) {
  if (!isValidKey(key)) {
    throw new Error('The Motion key must have 16 characters');
  }
  const tokenBytes = Buffer.from(String(token ?? ''), 'utf8');
  if (tokenBytes.length === 0 || tokenBytes.length % 16 !== 0) {
    throw new Error('The bridge sent a token of an unexpected length');
  }
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(tokenBytes), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

export const getDeviceListRequest = (date) => ({
  msgType: MSG.GET_DEVICE_LIST,
  msgID: messageId(date),
});

export const readDeviceRequest = ({ mac, deviceType, token, key }, date) => ({
  msgType: MSG.READ_DEVICE,
  mac,
  deviceType,
  AccessToken: accessToken(key, token),
  msgID: messageId(date),
});

export const writeDeviceRequest = ({ mac, deviceType, token, key }, data, date) => ({
  msgType: MSG.WRITE_DEVICE,
  mac,
  deviceType,
  AccessToken: accessToken(key, token),
  msgID: messageId(date),
  data,
});

const MAC = /^[0-9a-z]{12,16}$/;

/** A MAC as the bridge writes it (12 hex digits, 16 for a blind), lower-case. */
export function normalizeMac(value) {
  const mac = typeof value === 'string' ? value.trim().toLowerCase().replace(/[:-]/g, '') : '';
  return MAC.test(mac) ? mac : null;
}

/**
 * A GetDeviceListAck (one or several datagrams) as `{ mac, deviceType,
 * token, protocol, firmware, blinds: [{ mac, deviceType }] }`, or null.
 */
export function parseDeviceList(replies) {
  const list = (Array.isArray(replies) ? replies : [replies]).filter(
    (reply) => reply?.msgType === `${MSG.GET_DEVICE_LIST}Ack`,
  );
  if (list.length === 0) {
    return null;
  }
  const [first] = list;
  const mac = normalizeMac(first.mac);
  const deviceType = String(first.deviceType ?? '');
  if (!mac || !CONTROLLER_TYPES.includes(deviceType)) {
    return null;
  }
  const blinds = new Map();
  for (const reply of list) {
    for (const entry of Array.isArray(reply.data) ? reply.data : []) {
      const blindMac = normalizeMac(entry?.mac);
      const type = String(entry?.deviceType ?? '');
      if (blindMac && BLIND_DEVICE_TYPES.includes(type) && !blinds.has(blindMac)) {
        blinds.set(blindMac, { mac: blindMac, deviceType: type });
      }
    }
  }
  // The latest token wins: the bridge may change it between datagrams.
  const token = [...list].reverse().find((reply) => typeof reply.token === 'string')?.token;
  return {
    mac,
    deviceType,
    token: token ?? null,
    protocol: typeof first.ProtocolVersion === 'string' ? first.ProtocolVersion : null,
    firmware: typeof first.fwVersion === 'string' ? first.fwVersion : null,
    blinds: [...blinds.values()],
  };
}

const toInt = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
};

/**
 * Battery percentage from the pack voltage, the formula of the motionblinds
 * library: 2, 3 or 4 Li-ion cells. Null for a mains motor (≥ 100 V) or a
 * voltage no pack gives.
 */
export function batteryLevel(volts) {
  if (typeof volts !== 'number' || !Number.isFinite(volts)) {
    return null;
  }
  let level;
  if (volts <= 0) {
    level = 0;
  } else if (volts <= 9.4) {
    level = ((volts - 6.2) * 100) / (8.4 - 6.2);
  } else if (volts <= 13.6) {
    level = ((volts - 10.27) * 100) / (12.34 - 10.27);
  } else if (volts <= 19) {
    level = ((volts - 14.6) * 100) / (16.8 - 14.6);
  } else {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(level)));
}

/** Volts from `batteryLevel` (hundredths of a volt), or null. */
const volts = (raw) => {
  const value = toInt(raw);
  return value === null ? null : value / 100;
};

/** The largest raw angle of a motor: 90 for a Shangri-La or a double roller. */
export function maxAngle(deviceType, blindType) {
  return deviceType === DEVICE_TYPES.DOUBLE_ROLLER || blindType === BLIND_TYPES.SHANGRI_LA_BLIND
    ? 90
    : 180;
}

/**
 * The state of one blind from a ReadDeviceAck, a WriteDeviceAck or a Report.
 * Every value the motor did not give is null. Positions are the motor's
 * (0 = open), the angle is scaled to 0-180.
 * @param {object} reply the bridge's answer
 * @returns {object|null} null when the answer holds no state
 */
export function parseBlindState(reply) {
  const data = reply?.data;
  if (!data || typeof data !== 'object' || reply.actionResult !== undefined) {
    return null;
  }
  const deviceType = String(reply.deviceType ?? '');
  const blindType = toInt(data.type);
  const wirelessMode = toInt(data.wirelessMode);
  const voltageMode = toInt(data.voltageMode);
  const state = {
    deviceType,
    blindType,
    wirelessMode,
    voltageMode,
    operation: null,
    position: null,
    angle: null,
    top: null,
    batteryVolts: null,
    battery: null,
    charging: null,
    rssi: null,
  };
  if (wirelessMode === WIRELESS_MODE.UNI_DIRECTION) {
    // A one-way motor: the bridge only echoes the last command.
    return state;
  }
  state.rssi = toInt(data.RSSI);
  if (data.chargingState !== undefined) {
    state.charging = toInt(data.chargingState) === 1;
  }

  if (deviceType === DEVICE_TYPES.TDBU) {
    // Two motors, a top and a bottom rail. The bottom rail is the blind's
    // position; the lower of the two batteries is the blind's battery.
    state.operation = toInt(data.operation_B);
    state.position = toInt(data.currentPosition_B);
    state.top = toInt(data.currentPosition_T);
    const packs = [volts(data.batteryLevel_T), volts(data.batteryLevel_B)].filter(
      (value) => value !== null,
    );
    if (packs.length > 0) {
      state.batteryVolts = Math.min(...packs);
    }
  } else {
    state.operation = toInt(data.operation);
    state.batteryVolts = volts(data.batteryLevel);
    const limitsUnknown =
      wirelessMode === WIRELESS_MODE.BI_DIRECTION_LIMITS ||
      (wirelessMode === WIRELESS_MODE.VIRTUAL_PERCENTAGE_LIMITS &&
        (toInt(data.currentState) ?? 0) < BOTH_LIMITS);
    if (!limitsUnknown) {
      state.position = toInt(data.currentPosition);
      const raw = toInt(data.currentAngle);
      if (raw !== null) {
        state.angle = Math.round((raw * 180) / maxAngle(deviceType, blindType));
      }
    }
  }
  if (state.batteryVolts !== null && voltageMode !== VOLTAGE_MODE.AC) {
    state.battery = batteryLevel(state.batteryVolts);
  }
  for (const key of ['position', 'top']) {
    if (state[key] !== null) {
      state[key] = Math.min(100, Math.max(0, state[key]));
    }
  }
  if (state.angle !== null) {
    state.angle = Math.min(180, Math.max(0, state.angle));
  }
  return state;
}
