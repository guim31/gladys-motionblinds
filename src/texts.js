// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status and the "Search" report. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noBridge: {
    en: 'No Motion bridge found. Enter the IP address of your bridge in the configuration.',
    fr: "Aucun pont Motion trouvé. Saisissez l'adresse IP de votre pont dans la configuration.",
    de: 'Keine Motion-Bridge gefunden. Gib die IP-Adresse deiner Bridge in der Konfiguration ein.',
    es: 'No se ha encontrado ningún puente Motion. Introduzca la dirección IP de su puente en la configuración.',
  },
  noKey: {
    en: 'Enter the key of the Motion app in the configuration.',
    fr: "Saisissez la clé de l'application Motion dans la configuration.",
    de: 'Gib den Schlüssel der Motion-App in der Konfiguration ein.',
    es: 'Introduzca la clave de la aplicación Motion en la configuración.',
  },
  invalidKey: {
    en: 'The key must have 16 characters, dashes included, as the Motion app shows it.',
    fr: "La clé doit avoir 16 caractères, tirets compris, comme l'affiche l'application Motion.",
    de: 'Der Schlüssel muss 16 Zeichen haben, Bindestriche eingeschlossen, wie die Motion-App ihn anzeigt.',
    es: 'La clave debe tener 16 caracteres, guiones incluidos, tal como la muestra la aplicación Motion.',
  },
  keyRejected: {
    en: 'The Motion bridge refused the key: copy it again from the Motion app.',
    fr: "Le pont Motion a refusé la clé : copiez-la à nouveau depuis l'application Motion.",
    de: 'Die Motion-Bridge hat den Schlüssel abgelehnt: Kopiere ihn erneut aus der Motion-App.',
    es: 'El puente Motion ha rechazado la clave: cópiela de nuevo desde la aplicación Motion.',
  },
  noAnswer: {
    en: 'No Motion bridge answers.',
    fr: 'Aucun pont Motion ne répond.',
    de: 'Keine Motion-Bridge antwortet.',
    es: 'Ningún puente Motion responde.',
  },
};

const MAX_LISTED = 6;

// The pieces of the "Search" report, one table per language.
export const SEARCH_TEXT = {
  en: {
    none: 'No Motion bridge found: enter its IP address.',
    count: (total, reachable) => `${total} bridge(s), ${reachable} answering:`,
    blinds: (count) => `${count} blind(s)`,
    unreachable: 'not answering',
    keyOk: 'Key accepted.',
    keyRejected: 'The bridge refused the key: copy it again from the Motion app.',
    keyMissing: 'Enter the key of the Motion app.',
    keyInvalid: 'The key must have 16 characters.',
    unavailable: 'Automatic discovery through Gladys is unavailable: enter the IP address.',
    busy: 'A search has just run: the automatic discovery is available again in 10 seconds.',
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucun pont Motion trouvé : saisissez son adresse IP.',
    count: (total, reachable) => `${total} pont(s), ${reachable} répondent :`,
    blinds: (count) => `${count} store(s)`,
    unreachable: 'ne répond pas',
    keyOk: 'Clé acceptée.',
    keyRejected: "Le pont a refusé la clé : copiez-la à nouveau depuis l'application Motion.",
    keyMissing: "Saisissez la clé de l'application Motion.",
    keyInvalid: 'La clé doit avoir 16 caractères.',
    unavailable: "La découverte automatique par Gladys est indisponible : saisissez l'adresse IP.",
    busy: 'Une recherche vient de tourner : la découverte automatique est de nouveau possible dans 10 secondes.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Keine Motion-Bridge gefunden: Gib ihre IP-Adresse ein.',
    count: (total, reachable) => `${total} Bridge(s), davon ${reachable} erreichbar:`,
    blinds: (count) => `${count} Rollo(s)`,
    unreachable: 'antwortet nicht',
    keyOk: 'Schlüssel akzeptiert.',
    keyRejected: 'Die Bridge hat den Schlüssel abgelehnt: Kopiere ihn erneut aus der Motion-App.',
    keyMissing: 'Gib den Schlüssel der Motion-App ein.',
    keyInvalid: 'Der Schlüssel muss 16 Zeichen haben.',
    unavailable:
      'Die automatische Erkennung über Gladys ist nicht verfügbar: Gib die IP-Adresse ein.',
    busy: 'Gerade lief eine Suche: Die automatische Erkennung ist in 10 Sekunden wieder möglich.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún puente Motion: introduzca su dirección IP.',
    count: (total, reachable) => `${total} puente(s), ${reachable} responden:`,
    blinds: (count) => `${count} estor(es)`,
    unreachable: 'no responde',
    keyOk: 'Clave aceptada.',
    keyRejected: 'El puente ha rechazado la clave: cópiela de nuevo desde la aplicación Motion.',
    keyMissing: 'Introduzca la clave de la aplicación Motion.',
    keyInvalid: 'La clave debe tener 16 caracteres.',
    unavailable:
      'El descubrimiento automático a través de Gladys no está disponible: introduzca la dirección IP.',
    busy: 'Se acaba de realizar una búsqueda: el descubrimiento automático vuelve a estar disponible en 10 segundos.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

/** The report shown under the "Search" button, in every language. */
export function searchMessage(summary) {
  return Object.fromEntries(
    Object.entries(SEARCH_TEXT).map(([language, text]) => [language, searchReport(summary, text)]),
  );
}

const KEY_LINES = {
  ok: 'keyOk',
  rejected: 'keyRejected',
  missing: 'keyMissing',
  invalid: 'keyInvalid',
};

function searchReport({ bridges, key, scan, invalidHosts }, text) {
  const lines = [];
  if (bridges.length === 0) {
    lines.push(text.none);
  } else {
    const reachable = bridges.filter((bridge) => bridge.reachable).length;
    lines.push(text.count(bridges.length, reachable));
    // The first ones: the message stays readable under the button.
    const list = bridges
      .slice(0, MAX_LISTED)
      .map(({ host, blinds, reachable: up }) =>
        up ? `${host} (${text.blinds(blinds)})` : `${host} (${text.unreachable})`,
      );
    lines.push(`${list.join(', ')}${bridges.length > MAX_LISTED ? '…' : '.'}`);
  }
  if (KEY_LINES[key]) {
    lines.push(text[KEY_LINES[key]]);
  }
  if (scan === 'unavailable' && bridges.length === 0) {
    lines.push(text.unavailable);
  } else if (scan === 'busy' && bridges.length === 0) {
    lines.push(text.busy);
  }
  if (invalidHosts.length > 0) {
    lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}
