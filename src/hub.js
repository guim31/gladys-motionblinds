// -----------------------------------------------------------------------------
// The Motionblinds hub: finds the bridges and their blinds, reads the blinds at
// the configured pace, publishes their devices and states to Gladys, runs the
// commands and fires the scene trigger.
//
// Polling, by the container's own timer. A bridge pushes every change in
// multicast (238.0.0.18, port 32101), which never reaches a container on a
// Docker bridge network. So the hub reads the bridge's cache of every blind
// added to Gladys (ReadDevice, no radio traffic) every 30 s by default, and
// asks each two-way motor for its state over the radio every 15 minutes
// (Home Assistant does it every 10). After a command, it follows the motor
// every few seconds until it stops, like Home Assistant.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, so Gladys polls them too when it can, but the core cannot
// be trusted to (GladysAssistant/Gladys#3198): its onPoll is only a fallback,
// and a blind read less than half a period before is skipped.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import {
  COVER_STATE,
  CommandError,
  FEATURE_KEYS,
  buildDevice,
  capabilitiesOf,
  commandFor,
  coverCommand,
  deviceIds,
  deviceName,
  deviceValues,
  favoriteCommand,
  featureSpecs,
  isLocked,
  NAMES,
  namesFor,
  queryCommand,
  toGladys,
} from './devices.js';
import { parseScanReplies, scanRequest } from './discovery.js';
import { MotionBridge } from './motion/bridge.js';
import { DEVICE_TYPES, normalizeMac } from './motion/protocol.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT } from './texts.js';

const logger = createLogger({ name: 'motionblinds-hub' });

export const WIDGET_KEY = 'blinds';
export const TRIGGER = 'moved_outside_gladys';
export const DIRECTIONS = { OPENING: 'opening', CLOSING: 'closing' };

export const HUB_TIMINGS = {
  // A radio status query of each two-way motor (the cache follows the motor
  // reports, this catches a lost one). Battery motors wake up for it.
  queryMs: 15 * 60_000,
  // A new GetDeviceList: new blinds, a renewed token.
  listMs: 10 * 60_000,
  // A new search when a bridge is missing (DHCP gave it another address).
  rediscoveryMs: 15 * 60_000,
  // Following a motor after a command: every 5 s (10 s for a Wi-Fi motor,
  // read directly), for 2 minutes at most.
  followMs: 5_000,
  followWifiMs: 10_000,
  followMaxMs: 120_000,
  // A change seen this long after a Gladys command is not "outside Gladys".
  ownMoveMs: 180_000,
  // Polls in a row without answer before a bridge is "unreachable".
  unreachableAfter: 2,
  // Unchanged values are sent again this often, so Gladys never shows them
  // as stale ("no recent value" after 48 h).
  heartbeatMs: 6 * 3_600_000,
};

// Changes of these features change what the widget shows.
const WIDGET_KEYS = [FEATURE_KEYS.STATE, FEATURE_KEYS.POSITION, FEATURE_KEYS.BATTERY];

/**
 * Gladys refused a call or did not answer (restart, network, rate limit): a
 * passing condition, unlike a bug in the integration.
 */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

/** "fetch failed (ECONNREFUSED)": the low-level code Node hides in `cause`. */
const describe = (err) => {
  const code = err?.cause?.code;
  return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class MotionHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} options.transport MotionTransport
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, transport, timers = true, timings, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.transport = transport;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now;
    this.config = null;
    /** @type {Map<string, object>} bridges, by address */
    this.bridges = new Map();
    /** @type {Map<string, object>} blinds, by MAC address */
    this.records = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.polling = null;
    this.discovering = null;
    this.lastScan = { status: 'not-run', found: 0 };
    // 'read' or 'write' when the bridge refused the key on that kind of request.
    this.keyRejected = null;
    this.stopped = false;
    // Repeated failures (Gladys refusing, a bridge answering errors): one
    // line when they start and one when they end.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    this.reportConfigProblems();
    await this.restore();
    await this.discover();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    this.startTimers();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    this.reportConfigProblems();
    const keyChanged = previous?.key !== config.key;
    if (keyChanged) {
      this.keyRejected = null;
      this.problems.recover('key', null);
    }
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',') || keyChanged) {
      await this.discover();
    }
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    // New blinds, names in another language, gates allowed or not.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  /** A key or an address the user typed that cannot work: said once. */
  reportConfigProblems() {
    const { keyStatus, invalidHosts } = this.config;
    if (keyStatus === 'invalid') {
      this.problems.fail('config-key', 'The Motion key must have 16 characters');
    } else {
      this.problems.recover('config-key', null);
    }
    if (invalidHosts.length > 0) {
      this.problems.fail('config-hosts', `Ignored addresses: ${invalidHosts.join(', ')}`);
    } else {
      this.problems.recover('config-hosts', null);
    }
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    this.pollTimer = setInterval(() => this.track(this.pollAll()), this.config.pollSeconds * 1000);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscoverIfMissing()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.followTimer);
    }
    this.transport.close();
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /**
   * A periodic task failed. Gladys refusing or away is said once until it
   * accepts again; a bug is logged with its stack, once per message.
   */
  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail(
        'gladys',
        `Gladys does not take the Motionblinds updates: ${describe(err)}`,
      );
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Motionblinds updates again');
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [host, saved] of Object.entries(data.bridges ?? {})) {
      if (saved && typeof saved === 'object') {
        const bridge = this.bridgeAt(host, 'stored');
        bridge.mac = normalizeMac(saved.mac);
        bridge.deviceType = typeof saved.deviceType === 'string' ? saved.deviceType : null;
      }
    }
    for (const [key, saved] of Object.entries(data.blinds ?? {})) {
      const mac = normalizeMac(key);
      if (!mac || !saved || typeof saved.host !== 'string' || !saved.profile) {
        continue;
      }
      const record = this.createRecord(mac, saved.host, String(saved.profile.deviceType));
      record.profile = { ...saved.profile };
      record.caps = capabilitiesOf(record.profile);
      record.restoreAngle = typeof saved.restoreAngle === 'number' ? saved.restoreAngle : null;
      this.records.set(mac, record);
      this.bridgeAt(saved.host, 'stored');
    }
  }

  save() {
    const bridges = {};
    for (const bridge of this.bridges.values()) {
      if (bridge.mac) {
        bridges[bridge.host] = { mac: bridge.mac, deviceType: bridge.deviceType };
      }
    }
    const blinds = {};
    for (const record of this.records.values()) {
      if (record.profile) {
        blinds[record.mac] = {
          host: record.host,
          profile: record.profile,
          restoreAngle: record.restoreAngle,
        };
      }
    }
    return this.store.save({ bridges, blinds });
  }

  // --- Bridges and discovery -------------------------------------------------

  /** The bridge at an address, created when new. */
  bridgeAt(host, source) {
    let bridge = this.bridges.get(host);
    if (!bridge) {
      bridge = {
        host,
        source,
        client: new MotionBridge({
          host,
          transport: this.transport,
          getKey: () => this.config.key,
        }),
        mac: null,
        deviceType: null,
        protocol: null,
        firmware: null,
        blinds: 0,
        // null until the first answer or the first search without one.
        reachable: null,
        failures: 0,
        listedAt: null,
      };
      this.bridges.set(host, bridge);
    } else if (source === 'config') {
      bridge.source = 'config';
    }
    return bridge;
  }

  createRecord(mac, host, deviceType) {
    return {
      mac,
      host,
      deviceType,
      profile: null,
      caps: null,
      state: null,
      // The last open / close / stop sent to a one-way motor (it says nothing).
      assumedState: null,
      // The last slat angle other than 0, sent again with a new position.
      restoreAngle: null,
      readAt: null,
      // The first radio query comes one period after the start: the cache
      // is fresh enough, and battery motors are spared at every restart.
      queriedAt: this.now(),
      commandAt: null,
      // Bumped on every command: a read started before it is stale.
      commandSeq: 0,
      followTimer: null,
      follow: null,
      // Last values published, by feature key (for the widget nudges).
      published: {},
    };
  }

  /**
   * Search the bridges: the typed addresses, the ones the Gladys core's
   * discovery finds, the ones known from before; read every blind once.
   * Resolves with the number of bridges answering.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    for (const [host, bridge] of [...this.bridges.entries()]) {
      // An address removed from the configuration (a typo fixed...).
      if (bridge.source === 'config' && !this.config.hosts.includes(host)) {
        this.bridges.delete(host);
      }
    }
    for (const host of this.config.hosts) {
      this.bridgeAt(host, 'config');
    }
    for (const found of await this.scan()) {
      this.bridgeAt(found.host, 'scan');
    }
    let answering = 0;
    for (const bridge of [...this.bridges.values()]) {
      if ((await this.listBridge(bridge)).answered) {
        answering += 1;
      }
    }
    // A blind seen for the first time is read now: its type and radio decide
    // its features.
    for (const record of this.records.values()) {
      if (this.bridges.get(record.host)?.reachable === true && this.config.keyStatus === 'ok') {
        await this.refresh(record);
      }
    }
    await this.save();
    return answering;
  }

  /** One discovery broadcast through the Gladys core: `[{ host, mac }]`. */
  async scan() {
    try {
      const found = parseScanReplies(
        await this.gladys.scanNetwork('udp-active-broadcast', scanRequest()),
      );
      this.lastScan = { status: 'ok', found: found.length };
      this.problems.recover('scan', 'Motion bridge discovery through Gladys works again');
      return found;
    } catch (err) {
      // 403: a core without mediated discovery; 429 or 409: a scan ran less
      // than 10 s ago. The typed and known addresses still work.
      const status = err.status === 429 || err.status === 409 ? 'busy' : 'unavailable';
      const message = `Motion bridge discovery through Gladys failed: ${describe(err)}`;
      if (status === 'busy') {
        logger.debug(message);
      } else {
        this.problems.fail('scan', message, 'debug');
      }
      this.lastScan = { status, found: 0 };
      return [];
    }
  }

  /**
   * GetDeviceList on one bridge: its identity, its token, its blinds. A bridge
   * answering at a new address (DHCP) takes its blinds along.
   * @returns {Promise<{ answered: boolean, changed: boolean }>} whether it
   *   answered, and whether it brought new blinds (or new addresses)
   */
  async listBridge(bridge) {
    let list;
    try {
      list = await bridge.client.getDeviceList();
    } catch (err) {
      if (err.unreachable) {
        logger.debug(`No Motion answer from ${bridge.host}: ${err.message}`);
        await this.bridgeFailed(bridge, { searching: true });
      } else {
        this.problems.fail(`list:${bridge.host}`, `${bridge.host}: ${err.message}`);
      }
      return { answered: false, changed: false };
    }
    this.problems.recover(`list:${bridge.host}`, `${bridge.host} answers as a Motion bridge again`);
    bridge.listedAt = this.now();
    const known = bridge.mac !== null;
    Object.assign(bridge, {
      mac: list.mac,
      deviceType: list.deviceType,
      protocol: list.protocol,
      firmware: list.firmware,
      blinds: list.blinds.length,
    });
    // The same bridge known at another address: forget the old one.
    for (const other of [...this.bridges.values()]) {
      if (other !== bridge && other.mac === list.mac) {
        logger.info(`Motion bridge ${list.mac} moved from ${other.host} to ${bridge.host}`);
        this.bridges.delete(other.host);
      }
    }
    let added = false;
    for (const blind of list.blinds) {
      let record = this.records.get(blind.mac);
      if (!record) {
        record = this.createRecord(blind.mac, bridge.host, blind.deviceType);
        this.records.set(blind.mac, record);
        added = true;
      } else if (record.host !== bridge.host) {
        record.host = bridge.host;
        added = true;
      }
      record.deviceType = blind.deviceType;
    }
    if (!known) {
      logger.info(
        `Motion bridge ${list.mac} found at ${bridge.host} with ${list.blinds.length} blind(s)`,
      );
    }
    await this.bridgeAnswered(bridge);
    return { answered: true, changed: added || !known };
  }

  async rediscover() {
    await this.discover();
    // New blinds, and new addresses (DHCP) for the params of the created devices.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  /** The timer's search: only while no bridge answers at its address. */
  async rediscoverIfMissing() {
    const bridges = [...this.bridges.values()];
    if (bridges.length === 0 || bridges.some((bridge) => bridge.reachable === false)) {
      await this.rediscover();
    }
  }

  // --- Reachability -----------------------------------------------------------

  async bridgeAnswered(bridge) {
    bridge.failures = 0;
    if (bridge.reachable === true) {
      return;
    }
    const cameBack = bridge.reachable === false;
    bridge.reachable = true;
    if (cameBack) {
      logger.info(`Motion bridge at ${bridge.host} answers again`);
    }
    await this.publishTransports(this.recordsOf(bridge));
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async bridgeFailed(bridge, { searching = false } = {}) {
    if (this.stopped) {
      return;
    }
    bridge.failures += 1;
    if (bridge.reachable === false) {
      return;
    }
    if (bridge.reachable === null && searching) {
      // Never answered since the start: unreachable, said once below.
      bridge.reachable = false;
    } else if (bridge.failures < this.timings.unreachableAfter) {
      return;
    }
    bridge.reachable = false;
    logger.info(`Motion bridge at ${bridge.host} does not answer`);
    await this.publishTransports(this.recordsOf(bridge));
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  recordsOf(bridge) {
    return [...this.records.values()].filter((record) => record.host === bridge.host);
  }

  isReachable(record) {
    return this.bridges.get(record.host)?.reachable === true;
  }

  // --- Devices ---------------------------------------------------------------

  /** Blinds whose type is known (read once): the ones published. */
  knownRecords() {
    return [...this.records.values()].filter((record) => record.caps);
  }

  async publishDevices() {
    const devices = this.knownRecords().map((record) =>
      buildDevice(this.gladys, record, this.config),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record.mac).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The name the user gave the blind in Gladys, else the default one. */
  displayName(record, language) {
    const id = deviceIds(this.gladys, record.mac).device;
    const device = (this.gladys.devices ?? []).find((entry) => entry.external_id === id);
    return device?.name || deviceName(record, language);
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record?.caps) {
      throw new CommandError(`Unknown Motion blind ${externalId}`);
    }
    return record;
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish what changed for one blind, if the user created it (Gladys caps
   * states at 300 a minute and re-evaluates scenes on each one). Resolves
   * with the keys that changed.
   */
  async publishStates(record) {
    if (!record.caps || !this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.mac);
    const values = deviceValues(record);
    const states = [];
    const changed = [];
    for (const spec of featureSpecs(record.caps, this.config)) {
      const value = values[spec.key];
      if (value === undefined) {
        continue;
      }
      states.push({ device_feature_external_id: ids.feature(spec.key), state: value });
      if (!sameValue(record.published[spec.key], value)) {
        changed.push(spec.key);
      }
    }
    // The SDK sends only the values that changed since its last publication,
    // and the unchanged ones again after the heartbeat delay.
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const key of changed) {
      record.published[key] = values[key];
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.knownRecords()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        logger.debug(`Cannot publish the states of ${record.mac}: ${err.message}`);
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Read the blind and send them again.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record?.caps) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    if (this.isReachable(record) && this.config.keyStatus === 'ok') {
      await this.refresh(record);
    }
    await this.publishStates(record);
    await this.publishTransports([record]);
    this.requestWidgetRefresh();
  }

  async publishTransports(records = this.knownRecords()) {
    const entries = records
      .filter((record) => record.caps && this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.mac).device,
        transport: this.isReachable(record) ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const bridges = [...this.bridges.values()];
    if (bridges.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noBridge);
    } else if (this.config.keyStatus === 'missing') {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noKey);
    } else if (this.config.keyStatus === 'invalid') {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.invalidKey);
    } else if (!bridges.some((bridge) => bridge.reachable === true)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else if (this.keyRejected) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.keyRejected);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Polling -----------------------------------------------------------------

  /** One cycle of the timer: device lists when due, then the added blinds. */
  pollAll() {
    this.polling ??= this.runPoll()
      .then(() => this.gladysRecovered())
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  async runPoll() {
    if (this.config.keyStatus !== 'ok') {
      return;
    }
    let listed = false;
    for (const bridge of [...this.bridges.values()]) {
      // A bridge down is asked every cycle: one GetDeviceList tells when it
      // is back, without a read per blind.
      const due =
        bridge.listedAt === null ||
        bridge.reachable === false ||
        this.now() - bridge.listedAt >= this.timings.listMs;
      if (due) {
        listed = (await this.listBridge(bridge)).changed || listed;
      }
    }
    for (const record of [...this.records.values()]) {
      const bridge = this.bridges.get(record.host);
      if (bridge?.reachable === false) {
        continue;
      }
      if (!record.caps || this.isCreated(record)) {
        await this.refresh(record, { minGap: 0.5 });
      }
    }
    if (listed) {
      // A new blind, or a blind behind a bridge at a new address.
      await this.save();
      await this.publishDevices();
      await this.publishTransports();
    }
  }

  /** Gladys polls a device (fallback of the timer). */
  async pollFromCore(device) {
    const record = this.resolveDevice(device?.external_id);
    if (record && this.config.keyStatus === 'ok') {
      await this.refresh(record, { minGap: 0.5 });
    }
  }

  /**
   * Read one blind and publish what changed. The bridge's cache usually; a
   * radio status query when one is due for a two-way motor.
   * @param {object} record
   * @param {object} [options]
   * @param {number} [options.minGap] skip a blind read less than this many
   *   periods ago
   * @param {boolean} [options.query] force a radio status query
   */
  async refresh(record, { minGap = 0, query = false } = {}) {
    const now = this.now();
    if (minGap > 0 && record.readAt !== null) {
      if (now - record.readAt < this.config.pollSeconds * 1000 * minGap) {
        return;
      }
    }
    if (record.follow) {
      if (now - record.follow.startedAt < this.timings.followMaxMs) {
        // Already read every few seconds.
        return;
      }
      // A follow-up that never ended (its timer lost): reads take over.
      this.stopFollowing(record);
    }
    const bridge = this.bridges.get(record.host);
    if (!bridge) {
      return;
    }
    const radio =
      query ||
      (record.caps?.feedback === true &&
        !record.caps.wifi &&
        this.isCreated(record) &&
        (record.queriedAt === null || now - record.queriedAt >= this.timings.queryMs));
    const seq = record.commandSeq;
    record.readAt = now;
    let result;
    try {
      const ref = { mac: record.mac, deviceType: record.deviceType };
      result = radio
        ? await bridge.client.write(ref, queryCommand(record.caps ?? { tdbu: false }))
        : await bridge.client.read(ref);
    } catch (err) {
      await this.readFailed(record, bridge, err, radio ? 'write' : 'read');
      return;
    }
    if (radio) {
      record.queriedAt = now;
    }
    this.keyAccepted(radio ? 'write' : 'read');
    this.problems.recover(`read:${record.mac}`, `Motion blind ${record.mac} reads again`);
    await this.bridgeAnswered(bridge);
    if (seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this reading may predate it.
      return;
    }
    await this.applyReading(record, result.state);
  }

  async readFailed(record, bridge, err, kind) {
    if (err.unreachable) {
      await this.bridgeFailed(bridge);
    } else if (err.keyRejected) {
      await this.keyRefused(kind);
    } else {
      this.problems.fail(
        `read:${record.mac}`,
        `Cannot read Motion blind ${record.mac}: ${err.message}`,
      );
    }
  }

  async keyRefused(kind) {
    const known = this.keyRejected !== null;
    this.keyRejected = kind;
    this.problems.fail('key', 'The Motion bridge refused the key of the configuration');
    if (!known) {
      await this.publishConnectionStatus();
    }
  }

  keyAccepted(kind) {
    if (this.keyRejected !== null && (kind === 'write' || this.keyRejected === kind)) {
      this.keyRejected = null;
      this.problems.recover('key', 'The Motion bridge accepts the key again');
      this.track(this.publishConnectionStatus());
    }
  }

  /**
   * A fresh state of a blind: learn what it is, publish what changed, fire
   * the trigger when it moved without Gladys.
   */
  async applyReading(record, state) {
    if (!state) {
      return;
    }
    const structure = this.learn(record, state);
    const before = record.state;
    record.state = state;
    if (typeof state.angle === 'number' && state.angle !== 0) {
      record.restoreAngle = state.angle;
    }
    if (structure) {
      await this.save();
      await this.publishDevices();
      await this.publishTransports([record]);
    }
    this.detectOutsideMove(record, before, state);
    const changed = await this.publishStates(record);
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
  }

  /**
   * Keep what the blind told about itself; true when its features change
   * (first reading, a battery seen for the first time...).
   */
  learn(record, state) {
    const previous = record.profile;
    const profile = {
      deviceType: state.deviceType || record.deviceType,
      blindType: state.blindType ?? previous?.blindType ?? null,
      wirelessMode: state.wirelessMode ?? previous?.wirelessMode ?? null,
      // Once seen, kept: a reading without them must not remove features.
      battery: previous?.battery === true || state.battery !== null,
      charging: previous?.charging === true || state.charging !== null,
      signal: previous?.signal === true || state.rssi !== null,
    };
    if (sameValue(previous, profile)) {
      return false;
    }
    record.profile = profile;
    record.deviceType = profile.deviceType;
    const caps = capabilitiesOf(profile);
    const changed = !sameValue(record.caps, caps);
    record.caps = caps;
    if (!previous) {
      logger.debug(`Motion blind ${record.mac}: ${JSON.stringify(caps)}`);
    }
    return changed;
  }

  detectOutsideMove(record, before, after) {
    if (!record.caps.position || !this.isCreated(record)) {
      return;
    }
    if (record.commandAt !== null && this.now() - record.commandAt < this.timings.ownMoveMs) {
      return;
    }
    const was = toGladys(before?.position);
    const is = toGladys(after.position);
    if (was === null || is === null || was === is) {
      return;
    }
    this.track(
      this.gladys.publishSceneEvent(TRIGGER, {
        device: deviceIds(this.gladys, record.mac).device,
        direction: is > was ? DIRECTIONS.OPENING : DIRECTIONS.CLOSING,
        position: is,
      }),
    );
  }

  // --- Commands ----------------------------------------------------------------

  /** Commands need a key, a bridge that answers, and an unlocked blind. */
  checkCommand(record) {
    if (isLocked(record.caps, this.config)) {
      throw new CommandError(
        `${this.label(record)} is a gate: allow the gates in the configuration to control it`,
      );
    }
    if (this.config.keyStatus !== 'ok') {
      throw new CommandError('The Motion key is missing or invalid in the configuration');
    }
  }

  /**
   * Send a command to a blind, publish the state the bridge answers, then
   * follow the motor until it stops.
   * @param {object} record
   * @param {object} data WriteDevice data
   * @param {object} [options]
   * @param {number|null} [options.target] motor position aimed at
   * @param {number} [options.assumed] open / close / stop, for a one-way motor
   * @param {string} [options.what] for the log line
   */
  async send(record, data, { target = null, assumed, what = 'command' } = {}) {
    this.checkCommand(record);
    const bridge = this.bridges.get(record.host);
    if (!bridge) {
      throw new CommandError(`No Motion bridge known for ${this.label(record)}`);
    }
    record.commandSeq += 1;
    record.commandAt = this.now();
    this.stopFollowing(record);
    logger.info(`${this.label(record)}: ${what}`);
    let result;
    try {
      result = await bridge.client.write({ mac: record.mac, deviceType: record.deviceType }, data);
    } catch (err) {
      if (err.unreachable) {
        await this.bridgeFailed(bridge);
        throw new CommandError(`The Motion bridge at ${bridge.host} does not answer`);
      }
      if (err.keyRejected) {
        await this.keyRefused('write');
      }
      throw err;
    }
    this.keyAccepted('write');
    await this.bridgeAnswered(bridge);
    if (assumed !== undefined) {
      record.assumedState = assumed;
    }
    // The answer is the cache, before the motor moved: only for a one-way
    // motor or when the follow-up cannot run, it is all there is.
    await this.applyReading(record, result.state);
    if (!record.caps.feedback) {
      await this.publishStates(record);
      return;
    }
    record.follow = { target, startedAt: this.now(), last: null, stable: 0, moved: false };
    this.scheduleFollow(record);
  }

  stopFollowing(record) {
    clearTimeout(record.followTimer);
    record.followTimer = null;
    record.follow = null;
  }

  scheduleFollow(record) {
    if (!this.timersEnabled || this.stopped || !record.follow) {
      return;
    }
    const delay = record.caps.wifi ? this.timings.followWifiMs : this.timings.followMs;
    record.followTimer = setTimeout(() => {
      record.followTimer = null;
      this.track(this.followUp(record));
    }, delay);
  }

  /**
   * One follow-up read after a command: a radio status query (the cache only
   * changes when the motor reports), or a direct read of a Wi-Fi motor. Stops
   * once the motor reached its target, or stays still, or after 2 minutes.
   */
  async followUp(record) {
    const follow = record.follow;
    if (!follow) {
      return;
    }
    const bridge = this.bridges.get(record.host);
    if (!bridge) {
      record.follow = null;
      return;
    }
    const ref = { mac: record.mac, deviceType: record.deviceType };
    let result = null;
    try {
      result = record.caps.wifi
        ? await bridge.client.read(ref)
        : await bridge.client.write(ref, queryCommand(record.caps));
    } catch (err) {
      logger.debug(`Follow-up of ${record.mac} failed: ${err.message}`);
    }
    if (record.follow !== follow) {
      // A new command took over.
      return;
    }
    record.readAt = this.now();
    if (result?.state) {
      await this.applyReading(record, result.state);
      const position = result.state.position;
      if (follow.last !== null && position === follow.last) {
        follow.stable += 1;
      } else {
        follow.moved = follow.moved || follow.last !== null;
        follow.stable = 0;
      }
      follow.last = position;
    }
    const reached =
      follow.target !== null && result?.state?.position === follow.target && follow.stable >= 1;
    const still = follow.stable >= (follow.moved ? 2 : 5);
    const tooLong = this.now() - follow.startedAt >= this.timings.followMaxMs;
    if (reached || still || tooLong) {
      record.follow = null;
      return;
    }
    this.scheduleFollow(record);
  }

  /** A Gladys command on a feature of one of the blinds. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    this.checkCommand(record);
    const { data, target } = commandFor(record, key, value);
    const assumed = key === FEATURE_KEYS.STATE ? Math.sign(Number(value)) : undefined;
    await this.send(record, data, { target, assumed, what: `${key} ${value}` });
  }

  /** Open, close or stop (the widget's buttons). */
  async move(record, cover) {
    const target = cover === COVER_STATE.OPEN ? 0 : cover === COVER_STATE.CLOSE ? 100 : null;
    const what = { [COVER_STATE.OPEN]: 'open', [COVER_STATE.CLOSE]: 'close' }[cover] ?? 'stop';
    await this.send(record, coverCommand(record.caps, cover), { target, assumed: cover, what });
  }

  /** The favorite position stored in the motor (scene action). */
  async goFavorite(deviceExternalId) {
    const record = this.require(deviceExternalId);
    await this.send(record, favoriteCommand(record.caps), { what: 'favorite position' });
  }

  /**
   * Open, close or stop every blind added to Gladys whose bridge answers.
   * The gates are always left out. Resolves with the number of blinds moved.
   */
  async moveAll(cover) {
    let count = 0;
    const errors = [];
    for (const record of this.knownRecords()) {
      if (!this.isCreated(record) || record.caps.gate || !this.isReachable(record)) {
        continue;
      }
      try {
        await this.move(record, cover);
        count += 1;
      } catch (err) {
        errors.push(err);
      }
    }
    if (count === 0 && errors.length > 0) {
      throw errors[0];
    }
    return count;
  }

  label(record) {
    return `${namesFor('en')[record.caps?.typeKey] ?? NAMES.en.blind} ${record.mac}`;
  }

  // --- Search action -------------------------------------------------------------

  /**
   * The "Search" action: a new search, then a check of the key with a status
   * query on one blind (a radio question, nothing moves).
   */
  async search() {
    this.keyRejected = null;
    this.problems.recover('key', null);
    await this.rediscover();
    let key = this.config.keyStatus;
    if (key === 'ok') {
      // Any blind behind a bridge that answers, read or not yet.
      const record = [...this.records.values()].find((entry) => this.isReachable(entry));
      if (!record) {
        key = this.keyRejected ? 'rejected' : 'untested';
      } else {
        const bridge = this.bridges.get(record.host);
        try {
          await bridge.client.write(
            { mac: record.mac, deviceType: record.deviceType },
            queryCommand({ tdbu: record.deviceType === DEVICE_TYPES.TDBU }),
          );
          this.keyAccepted('write');
        } catch (err) {
          if (err.keyRejected) {
            await this.keyRefused('write');
            key = 'rejected';
          } else {
            key = 'untested';
          }
        }
      }
      await this.publishConnectionStatus();
    }
    return this.summary(key);
  }

  /** What the Configuration screen's "Search" action reports. */
  summary(key = this.keyRejected ? 'rejected' : this.config.keyStatus) {
    return {
      scan: this.lastScan.status,
      key,
      invalidHosts: this.config.invalidHosts,
      bridges: [...this.bridges.values()].map((bridge) => ({
        host: bridge.host,
        mac: bridge.mac,
        blinds: bridge.blinds,
        reachable: bridge.reachable === true,
      })),
    };
  }
}
