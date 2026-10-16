// -----------------------------------------------------------------------------
// From a Motion blind to a Gladys device, and back: discovery payload, state
// values, and the WriteDevice data of each command.
//
// One Gladys device per blind (per motor of a Wi-Fi motor), keyed on its MAC
// address. Only what the motor can do is published:
//   - every blind: open / close / stop (`state`);
//   - a motor that knows its position: the position (`position`);
//   - venetian, Shangri-La, vertical blinds, double rollers: the slat tilt
//     (`tilt`), a second position slider, since Gladys has no tilt feature;
//   - a top-down bottom-up blind: the bottom rail is the position, the top
//     rail a second slider (`top`);
//   - a battery motor: its level (`battery`), its charge when it reports one
//     (`charging`); a two-way motor: its radio signal (`signal`).
//
// Positions are turned around: the motor counts 0 = open, Gladys 100 = open
// (its slider says "0% = closed"). The slat tilt follows the same rule:
// 100 = slats open, 0 = slats closed.
//
// A garage door or a gate opens the house: its commands are read-only unless
// the configuration allows them (`allow_gates`).
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  BLIND_TYPES,
  DEVICE_TYPES,
  KNOWN_BLIND_TYPES,
  OPERATION,
  WIFI_DEVICE_TYPES,
  WIRELESS_MODE,
  maxAngle,
} from './motion/protocol.js';

export const DEVICE_TYPE = 'blind';

export const FEATURE_KEYS = {
  STATE: 'state',
  POSITION: 'position',
  TILT: 'tilt',
  TOP: 'top',
  BATTERY: 'battery',
  CHARGING: 'charging',
  SIGNAL: 'signal',
};

/** Values of the Gladys open / close / stop feature (COVER_STATE). */
export const COVER_STATE = { CLOSE: -1, STOP: 0, OPEN: 1 };

const TILT_TYPES = [
  BLIND_TYPES.VENETIAN_BLIND,
  BLIND_TYPES.SHANGRI_LA_BLIND,
  BLIND_TYPES.DOUBLE_ROLLER,
  BLIND_TYPES.DUAL_SHADE,
  BLIND_TYPES.VERTICAL_BLIND,
  BLIND_TYPES.VERTICAL_BLIND_LEFT,
  BLIND_TYPES.VERTICAL_BLIND_RIGHT,
  BLIND_TYPES.ROLLER_TILT_MOTOR,
];
const CURTAIN_TYPES = [BLIND_TYPES.CURTAIN, BLIND_TYPES.CURTAIN_LEFT, BLIND_TYPES.CURTAIN_RIGHT];

// Feature and device names are frozen when the user creates the device:
// written in the language chosen in the configuration at that moment. The
// numbered keys are the blind types of the Motion app.
export const NAMES = {
  en: {
    state: 'Open / close',
    position: 'Position',
    tilt: 'Slat tilt',
    top: 'Top rail position',
    battery: 'Battery',
    charging: 'Charging',
    signal: 'Radio signal',
    blind: 'Blind',
    garageDoor: 'Garage door',
    1: 'Roller blind',
    2: 'Venetian blind',
    3: 'Roman blind',
    4: 'Honeycomb blind',
    5: 'Shangri-La blind',
    6: 'Roller shutter',
    7: 'Roller gate',
    8: 'Awning',
    9: 'Top-down bottom-up blind',
    10: 'Day-night blind',
    11: 'Dimming blind',
    12: 'Curtain',
    13: 'Curtain (left)',
    14: 'Curtain (right)',
    15: 'Tilt motor',
    17: 'Double roller blind',
    21: 'Vertical blind (left)',
    22: 'Wooden shutter',
    24: 'Radio receiver',
    26: 'Skylight blind',
    27: 'Dual shade',
    28: 'Vertical blind',
    29: 'Vertical blind (right)',
    40: 'Woven wood shade',
    43: 'Switch',
    44: 'Insect screen',
    57: 'Triangle blind',
  },
  fr: {
    state: 'Ouvrir / fermer',
    position: 'Position',
    tilt: 'Inclinaison des lamelles',
    top: 'Position du rail haut',
    battery: 'Batterie',
    charging: 'En charge',
    signal: 'Signal radio',
    blind: 'Store',
    garageDoor: 'Porte de garage',
    1: 'Store enrouleur',
    2: 'Store vénitien',
    3: 'Store bateau',
    4: 'Store plissé alvéolaire',
    5: 'Store Shangri-La',
    6: 'Volet roulant',
    7: 'Porte roulante',
    8: 'Store banne',
    9: 'Store haut-bas',
    10: 'Store jour-nuit',
    11: 'Store tamisant',
    12: 'Rideau',
    13: 'Rideau (gauche)',
    14: 'Rideau (droite)',
    15: "Moteur d'orientation",
    17: 'Store double',
    21: 'Store à bandes verticales (gauche)',
    22: 'Volet en bois',
    24: 'Récepteur radio',
    26: 'Store de fenêtre de toit',
    27: 'Store double toile',
    28: 'Store à bandes verticales',
    29: 'Store à bandes verticales (droite)',
    40: 'Store en bois tressé',
    43: 'Commutateur',
    44: 'Moustiquaire',
    57: 'Store triangulaire',
  },
  de: {
    state: 'Öffnen / Schließen',
    position: 'Position',
    tilt: 'Lamellenneigung',
    top: 'Position der oberen Schiene',
    battery: 'Akku',
    charging: 'Lädt',
    signal: 'Funksignal',
    blind: 'Rollo',
    garageDoor: 'Garagentor',
    1: 'Rollo',
    2: 'Jalousie',
    3: 'Raffrollo',
    4: 'Wabenplissee',
    5: 'Shangri-La-Rollo',
    6: 'Rollladen',
    7: 'Rolltor',
    8: 'Markise',
    9: 'Plissee oben/unten',
    10: 'Doppelrollo',
    11: 'Abdunkelungsrollo',
    12: 'Vorhang',
    13: 'Vorhang (links)',
    14: 'Vorhang (rechts)',
    15: 'Wendemotor',
    17: 'Doppelrollo (zwei Stoffe)',
    21: 'Vertikaljalousie (links)',
    22: 'Holzladen',
    24: 'Funkempfänger',
    26: 'Dachfensterrollo',
    27: 'Duo-Rollo',
    28: 'Vertikaljalousie',
    29: 'Vertikaljalousie (rechts)',
    40: 'Holzgeflecht-Rollo',
    43: 'Schalter',
    44: 'Insektenschutz',
    57: 'Dreieck-Plissee',
  },
  es: {
    state: 'Abrir / cerrar',
    position: 'Posición',
    tilt: 'Inclinación de las lamas',
    top: 'Posición del riel superior',
    battery: 'Batería',
    charging: 'Cargando',
    signal: 'Señal de radio',
    blind: 'Estor',
    garageDoor: 'Puerta de garaje',
    1: 'Estor enrollable',
    2: 'Persiana veneciana',
    3: 'Estor plegable',
    4: 'Estor de panal',
    5: 'Estor Shangri-La',
    6: 'Persiana enrollable',
    7: 'Puerta enrollable',
    8: 'Toldo',
    9: 'Estor de doble apertura',
    10: 'Estor noche y día',
    11: 'Estor regulable',
    12: 'Cortina',
    13: 'Cortina (izquierda)',
    14: 'Cortina (derecha)',
    15: 'Motor de inclinación',
    17: 'Estor doble',
    21: 'Cortina vertical (izquierda)',
    22: 'Contraventana de madera',
    24: 'Receptor de radio',
    26: 'Estor de claraboya',
    27: 'Estor dual',
    28: 'Cortina vertical',
    29: 'Cortina vertical (derecha)',
    40: 'Estor de madera tejida',
    43: 'Interruptor',
    44: 'Mosquitera',
    57: 'Estor triangular',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/** External ids of the Gladys device of a blind. */
export const deviceIds = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac);

/**
 * What a blind can do, from what it told about itself (`profile`, kept in
 * /data): `{ kind, gate, tdbu, position, tilt, feedback, battery, charging,
 * signal, typeKey, maxAngle }`.
 * @param {object} profile `{ deviceType, blindType, wirelessMode, battery, charging, signal }`
 */
export function capabilitiesOf(profile) {
  const { deviceType } = profile;
  // An unknown type is driven like a roller blind, as Home Assistant does.
  const blindType = KNOWN_BLIND_TYPES.includes(profile.blindType)
    ? profile.blindType
    : deviceType === DEVICE_TYPES.WIFI_CURTAIN
      ? BLIND_TYPES.CURTAIN
      : BLIND_TYPES.ROLLER_BLIND;
  const mode = profile.wirelessMode;
  const gate = deviceType === DEVICE_TYPES.WIFI_GATE || blindType === BLIND_TYPES.ROLLER_GATE;
  const tdbu = deviceType === DEVICE_TYPES.TDBU;
  const feedback = mode !== WIRELESS_MODE.UNI_DIRECTION;
  const position =
    feedback && mode !== WIRELESS_MODE.BI_DIRECTION_LIMITS && blindType !== BLIND_TYPES.SWITCH;
  const curtain = deviceType === DEVICE_TYPES.WIFI_CURTAIN || CURTAIN_TYPES.includes(blindType);
  return {
    kind: curtain ? 'curtain' : 'shutter',
    gate,
    tdbu,
    wifi: WIFI_DEVICE_TYPES.includes(deviceType),
    position,
    tilt: position && !tdbu && TILT_TYPES.includes(blindType),
    feedback,
    battery: feedback && profile.battery === true,
    charging: feedback && profile.battery === true && profile.charging === true,
    signal: feedback && profile.signal === true,
    typeKey: deviceType === DEVICE_TYPES.WIFI_GATE ? 'garageDoor' : String(blindType),
    maxAngle: maxAngle(deviceType, blindType),
  };
}

/** Default name: "<type> <end of the MAC>"; the user renames it in Gladys. */
export function deviceName(record, language) {
  const names = namesFor(language);
  const type = names[record.caps.typeKey] ?? names.blind;
  return `${type} ${record.mac.slice(-4).toUpperCase()}`;
}

/** Commands of a gate are locked unless the configuration allows them. */
export const isLocked = (caps, config) => caps.gate && !config.allowGates;

/**
 * Feature specs of a blind, in publication order.
 * @param {object} caps capabilitiesOf() of the blind
 * @param {object} config normalized configuration (language, allowGates)
 */
export function featureSpecs(caps, config) {
  const names = namesFor(config.language);
  const category = caps.kind === 'curtain' ? CATEGORIES.CURTAIN : CATEGORIES.SHUTTER;
  const types = caps.kind === 'curtain' ? TYPES.CURTAIN : TYPES.SHUTTER;
  const locked = isLocked(caps, config);
  const specs = [
    {
      key: FEATURE_KEYS.STATE,
      name: names.state,
      category,
      type: types.STATE,
      min: COVER_STATE.CLOSE,
      max: COVER_STATE.OPEN,
      read_only: locked,
      feedback: caps.feedback,
      history: true,
    },
  ];
  if (caps.position) {
    specs.push({
      key: FEATURE_KEYS.POSITION,
      name: names.position,
      category,
      type: types.POSITION,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: locked,
      feedback: true,
      history: true,
    });
  }
  if (caps.tdbu && caps.position) {
    specs.push({
      key: FEATURE_KEYS.TOP,
      name: names.top,
      category,
      type: types.POSITION,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: locked,
      feedback: true,
      history: true,
    });
  }
  if (caps.tilt) {
    specs.push({
      key: FEATURE_KEYS.TILT,
      name: names.tilt,
      category,
      type: types.POSITION,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: locked,
      feedback: true,
      history: false,
    });
  }
  if (caps.battery) {
    specs.push({
      key: FEATURE_KEYS.BATTERY,
      name: names.battery,
      category: CATEGORIES.BATTERY,
      type: TYPES.BATTERY.INTEGER,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      feedback: true,
      history: true,
    });
  }
  if (caps.charging) {
    specs.push({
      key: FEATURE_KEYS.CHARGING,
      name: names.charging,
      category: CATEGORIES.BATTERY,
      type: TYPES.BATTERY.CHARGING,
      min: 0,
      max: 1,
      read_only: true,
      feedback: true,
      history: true,
    });
  }
  if (caps.signal) {
    // In dBm, which Gladys has no unit for.
    specs.push({
      key: FEATURE_KEYS.SIGNAL,
      name: names.signal,
      category: CATEGORIES.SIGNAL,
      type: TYPES.SIGNAL.QUALITY,
      min: -120,
      max: 0,
      read_only: true,
      feedback: true,
      history: false,
    });
  }
  return specs;
}

/** Discovery payload of one blind. */
export function buildDevice(gladys, record, config) {
  const ids = deviceIds(gladys, record.mac);
  return {
    name: deviceName(record, config.language),
    external_id: ids.device,
    model: `Motionblinds ${namesFor('en')[record.caps.typeKey] ?? NAMES.en.blind}`,
    // The container reads the blinds itself at the configured pace
    // (src/hub.js): Gladys polls them too when it can, as a fallback, and
    // the hub skips a blind read less than half a period before.
    should_poll: true,
    poll_frequency: config.pollSeconds * 1000,
    params: [
      { name: 'BRIDGE_IP', value: record.host },
      { name: 'MAC_ADDRESS', value: record.mac },
    ],
    features: featureSpecs(record.caps, config).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: spec.feedback === true,
        keep_history: spec.history,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      return feature;
    }),
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Gladys position (100 = open) from the motor's (0 = open), and back. */
export const toGladys = (motor) => (isNumber(motor) ? 100 - motor : null);
export const toMotor = (gladys) => 100 - Math.min(100, Math.max(0, Math.round(Number(gladys))));

/** Slat opening in % (100 = open) from the 0-180 angle (0 = open), and back. */
export const tiltFromAngle = (angle) => (isNumber(angle) ? Math.round(100 - angle / 1.8) : null);
export const angleFromTilt = (tilt) => 180 - Math.min(100, Math.max(0, Number(tilt))) * 1.8;

/**
 * The value of the open / close / stop feature: the direction while the
 * motor runs, open or closed at the ends, stopped in between. Null when the
 * motor tells nothing (one-way radio).
 */
export function coverState(state) {
  if (!state) {
    return null;
  }
  if (state.operation === OPERATION.OPEN) {
    return COVER_STATE.OPEN;
  }
  if (state.operation === OPERATION.CLOSE) {
    return COVER_STATE.CLOSE;
  }
  if (!isNumber(state.position)) {
    return null;
  }
  if (state.position === 0) {
    return COVER_STATE.OPEN;
  }
  if (state.position === 100) {
    return COVER_STATE.CLOSE;
  }
  return COVER_STATE.STOP;
}

/** The values to publish for a blind, by feature key (missing: unknown). */
export function deviceValues(record) {
  const { caps, state } = record;
  const values = {};
  // A motor that tells no position (one-way radio, end limits only): the
  // last open / close / stop Gladys sent.
  const cover = (caps.feedback ? coverState(state) : null) ?? record.assumedState;
  if (cover !== null && cover !== undefined) {
    values[FEATURE_KEYS.STATE] = cover;
  }
  if (!state) {
    return values;
  }
  const set = (key, enabled, value) => {
    if (enabled && value !== null && value !== undefined) {
      values[key] = value;
    }
  };
  set(FEATURE_KEYS.POSITION, caps.position, toGladys(state.position));
  set(FEATURE_KEYS.TOP, caps.tdbu && caps.position, toGladys(state.top));
  set(FEATURE_KEYS.TILT, caps.tilt, tiltFromAngle(state.angle));
  set(FEATURE_KEYS.BATTERY, caps.battery, state.battery);
  set(FEATURE_KEYS.CHARGING, caps.charging, state.charging === null ? null : +state.charging);
  set(FEATURE_KEYS.SIGNAL, caps.signal, state.rssi);
  return values;
}

/** The WriteDevice data of the open / close / stop commands. */
export function coverCommand(caps, value) {
  const cover = Math.sign(Number(value));
  if (caps.tdbu) {
    // Both rails, as the Motion app does for the whole blind.
    if (cover === COVER_STATE.OPEN) {
      return { targetPosition_B: 0, targetPosition_T: 0 };
    }
    if (cover === COVER_STATE.CLOSE) {
      return { targetPosition_B: 100, targetPosition_T: 0 };
    }
    return { operation_B: OPERATION.STOP, operation_T: OPERATION.STOP };
  }
  if (cover === COVER_STATE.OPEN) {
    return { operation: OPERATION.OPEN };
  }
  if (cover === COVER_STATE.CLOSE) {
    return { operation: OPERATION.CLOSE };
  }
  return { operation: OPERATION.STOP };
}

/** WriteDevice data of the status query (radio) and of the favorite position. */
export const queryCommand = (caps) =>
  caps.tdbu
    ? { operation_T: OPERATION.QUERY, operation_B: OPERATION.QUERY }
    : { operation: OPERATION.QUERY };
export const favoriteCommand = (caps) =>
  caps.tdbu
    ? { operation_B: OPERATION.GO_FAVORITE, operation_T: OPERATION.GO_FAVORITE }
    : { operation: OPERATION.GO_FAVORITE };

export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * The WriteDevice data of a Gladys command on a feature, with the motor
 * position it aims at (`target`, for the follow-up reads).
 * @returns {{ data: object, target: number|null }}
 */
export function commandFor(record, key, value) {
  const { caps, state } = record;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new CommandError(`Invalid value ${value}`);
  }
  switch (key) {
    case FEATURE_KEYS.STATE: {
      const cover = Math.sign(number);
      const target = cover === COVER_STATE.OPEN ? 0 : cover === COVER_STATE.CLOSE ? 100 : null;
      return { data: coverCommand(caps, cover), target };
    }
    case FEATURE_KEYS.POSITION: {
      if (!caps.position) {
        break;
      }
      const target = toMotor(number);
      if (caps.tdbu) {
        if (isNumber(state?.top) && target < state.top) {
          throw new CommandError('The bottom rail cannot go above the top rail');
        }
        return { data: { targetPosition_B: target }, target };
      }
      const data = { targetPosition: target };
      if (caps.tilt && isNumber(record.restoreAngle) && target !== 0) {
        // Keep the slat tilt, like the Motion app and Home Assistant.
        data.targetAngle = Math.round((record.restoreAngle * caps.maxAngle) / 180);
      }
      return { data, target };
    }
    case FEATURE_KEYS.TOP: {
      if (!caps.tdbu || !caps.position) {
        break;
      }
      const target = toMotor(number);
      if (isNumber(state?.position) && target > state.position) {
        throw new CommandError('The top rail cannot go below the bottom rail');
      }
      return { data: { targetPosition_T: target }, target: null };
    }
    case FEATURE_KEYS.TILT: {
      if (!caps.tilt) {
        break;
      }
      const angle = angleFromTilt(number);
      return {
        data: { targetAngle: Math.round((angle * caps.maxAngle) / 180) },
        target: null,
      };
    }
    default:
      break;
  }
  throw new CommandError(`The feature "${key}" cannot be controlled`);
}
