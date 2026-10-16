// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `blinds`.
//
// The Gladys device boxes already drive each blind (open, close, stop, the
// position and slat sliders). What the widget adds: every Motion blind of the
// house on one card, where each one stands, which ones run low on battery or
// no longer answer, and three buttons for all of them at once.
//
// Budget (8 components, 2 texts, 1 status of 10 rows, 4 buttons): a caption,
// one status list, and the open / stop / close buttons. Garages and gates are
// listed but never moved by these buttons: opening the house takes a
// deliberate action on its own device.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { COVER_STATE, coverState, toGladys } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { OPERATION } from './motion/protocol.js';

const MAX_ROWS = 10;
const MAX_LABEL = 40;
// Below this level a battery is shown on the row.
export const LOW_BATTERY = 20;

export const ACTIONS = {
  open_all: COVER_STATE.OPEN,
  stop_all: COVER_STATE.STOP,
  close_all: COVER_STATE.CLOSE,
};

export const TEXT = {
  empty: {
    en: 'Add your Motion blinds to Gladys from the Discovery tab of the integration.',
    fr: "Ajoutez vos stores Motion à Gladys depuis l'onglet Découverte de l'intégration.",
    de: 'Füge deine Motion-Rollos über den Tab „Entdecken“ der Integration zu Gladys hinzu.',
    es: 'Añada sus estores Motion a Gladys desde la pestaña Descubrir de la integración.',
  },
  blinds: { en: 'blinds', fr: 'stores', de: 'Rollos', es: 'estores' },
  answering: { en: 'answering', fr: 'répondent', de: 'erreichbar', es: 'responden' },
  open: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierto' },
  closed: { en: 'Closed', fr: 'Fermé', de: 'Geschlossen', es: 'Cerrado' },
  stopped: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  opening: { en: 'opening', fr: 'ouverture', de: 'öffnet', es: 'abriendo' },
  closing: { en: 'closing', fr: 'fermeture', de: 'schließt', es: 'cerrando' },
  battery: { en: 'battery', fr: 'batterie', de: 'Akku', es: 'batería' },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  others: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  openAll: { en: 'Open all', fr: 'Tout ouvrir', de: 'Alle öffnen', es: 'Abrir todo' },
  stopAll: { en: 'Stop all', fr: 'Tout arrêter', de: 'Alle stoppen', es: 'Detener todo' },
  closeAll: { en: 'Close all', fr: 'Tout fermer', de: 'Alle schließen', es: 'Cerrar todo' },
  opened: {
    en: 'blind(s) opening',
    fr: 'store(s) en ouverture',
    de: 'Rollo(s) öffnen',
    es: 'estor(es) abriéndose',
  },
  stoppedAll: {
    en: 'blind(s) stopped',
    fr: 'store(s) arrêté(s)',
    de: 'Rollo(s) gestoppt',
    es: 'estor(es) detenido(s)',
  },
  closedAll: {
    en: 'blind(s) closing',
    fr: 'store(s) en fermeture',
    de: 'Rollo(s) schließen',
    es: 'estor(es) cerrándose',
  },
  none: {
    en: 'No blind could be reached.',
    fr: "Aucun store n'a pu être joint.",
    de: 'Kein Rollo war erreichbar.',
    es: 'No se ha podido contactar con ningún estor.',
  },
};

const t = (text, language) => text[language] ?? text.en;

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One status row: where the blind stands, in words. */
export function rowFor(hub, record, language) {
  const label = truncate(hub.displayName(record, language), MAX_LABEL);
  if (!hub.isReachable(record)) {
    return {
      label,
      icon: 'wifi-off',
      value: t(TEXT.unreachable, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  const state = record.state;
  const parts = [];
  const position = record.caps.position ? toGladys(state?.position) : null;
  const cover = (record.caps.feedback ? coverState(state) : null) ?? record.assumedState;
  if (position !== null) {
    parts.push(`${position} %`);
  } else if (cover === COVER_STATE.OPEN) {
    parts.push(t(TEXT.open, language));
  } else if (cover === COVER_STATE.CLOSE) {
    parts.push(t(TEXT.closed, language));
  } else if (cover === COVER_STATE.STOP) {
    parts.push(t(TEXT.stopped, language));
  }
  const moving =
    state?.operation === OPERATION.OPEN
      ? TEXT.opening
      : state?.operation === OPERATION.CLOSE
        ? TEXT.closing
        : null;
  if (moving) {
    parts.push(t(moving, language));
  }
  const battery = record.caps.battery ? state?.battery : null;
  const low = typeof battery === 'number' && battery < LOW_BATTERY;
  if (low) {
    parts.push(`${t(TEXT.battery, language)} ${battery} %`);
  }
  return {
    label,
    icon: record.caps.gate ? 'home' : 'sliders',
    value: parts.length > 0 ? truncate(parts.join(' · '), MAX_LABEL) : '—',
    color: low
      ? WIDGET_COLORS.WARNING
      : moving
        ? WIDGET_COLORS.INFO
        : position !== null && position > 0
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { language = 'en' } = {}) {
  const records = hub
    .knownRecords()
    .filter((record) => hub.isCreated(record))
    .map((record) => ({ record, name: hub.displayName(record, language) }))
    .sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }))
    .map(({ record }) => record);
  if (records.length === 0) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.empty, language) }],
    };
  }
  const reachable = records.filter((record) => hub.isReachable(record)).length;
  const caption = `Motionblinds · ${records.length} ${t(TEXT.blinds, language)} · ${reachable} ${t(TEXT.answering, language)}`;
  const shown = records.length > MAX_ROWS ? records.slice(0, MAX_ROWS - 1) : records;
  const items = shown.map((record) => rowFor(hub, record, language));
  if (records.length > MAX_ROWS) {
    items.push({
      label: t(TEXT.others, language),
      icon: 'more-horizontal',
      value: records.length - shown.length,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'caption', text: caption },
      { type: 'status', items },
      {
        type: 'button',
        label: t(TEXT.openAll, language),
        icon: 'chevrons-up',
        style: 'secondary',
        action: { key: 'open_all', confirm: true },
      },
      {
        type: 'button',
        label: t(TEXT.stopAll, language),
        icon: 'pause',
        style: 'secondary',
        action: { key: 'stop_all' },
      },
      {
        type: 'button',
        label: t(TEXT.closeAll, language),
        icon: 'chevrons-down',
        style: 'secondary',
        action: { key: 'close_all', confirm: true },
      },
    ],
  };
}

const DONE = {
  [COVER_STATE.OPEN]: TEXT.opened,
  [COVER_STATE.STOP]: TEXT.stoppedAll,
  [COVER_STATE.CLOSE]: TEXT.closedAll,
};

async function action(hub, { actionKey }) {
  if (!(actionKey in ACTIONS)) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const cover = ACTIONS[actionKey];
  const count = await hub.moveAll(cover);
  hub.requestWidgetRefresh();
  if (count === 0) {
    return { message: TEXT.none };
  }
  return {
    message: Object.fromEntries(
      Object.entries(DONE[cover]).map(([language, text]) => [language, `${count} ${text}`]),
    ),
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
