// -----------------------------------------------------------------------------
// Fake Motion bridges on a fake UDP network: `createNetwork(bridges).createSocket`
// replaces `dgram.createSocket` in the transport. Each bridge answers the
// messages of its fixture (test/fixtures/motion), checks the AccessToken like
// a real one, and drives its motors.
//
// A real bridge answers a command with its cache, before the motor moves; the
// cache follows the motor when the motor reports (end of a move) or answers a
// status query (operation 5). So does the fake: `motors` is what the blinds
// really do, `cache` what the bridge answers. By default a motor reaches its
// target and reports at once; with `instant = false` it moves one `step()`
// at a time and only a query brings its position to the cache.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { accessToken, MOTION_PORT } from '../../src/motion/protocol.js';

const FIXTURES = new URL('../fixtures/motion/', import.meta.url);

export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
}

export const TEST_KEY = '12ab345c-d67e-8f';

const clone = (value) => structuredClone(value);

export class FakeBridge {
  /**
   * @param {string} fixture name of a fixture file
   * @param {string} host IPv4 address of the bridge
   * @param {object} [options]
   * @param {string} [options.key] the key the bridge accepts
   */
  constructor(fixture, host, { key = TEST_KEY } = {}) {
    this.fixture = loadFixture(fixture);
    this.host = host;
    this.key = key;
    this.mac = this.fixture.deviceList.mac;
    this.deviceType = this.fixture.deviceList.deviceType;
    this.token = this.fixture.deviceList.token;
    /** @type {Map<string, object>} what the bridge answers, by blind MAC */
    this.cache = new Map(
      Object.entries(this.fixture.devices).map(([mac, ack]) => [mac, clone(ack)]),
    );
    /** @type {Map<string, object>} what the motors really do */
    this.motors = new Map(
      Object.entries(this.fixture.devices).map(([mac, ack]) => [mac, clone(ack.data)]),
    );
    this.targets = new Map();
    this.instant = true;
    this.online = true;
    // Datagrams to drop before answering again (UDP loss).
    this.drop = 0;
    // Extra blinds (to make a long device list).
    this.extraBlinds = [];
    this.received = [];
  }

  blindMacs() {
    return [...this.cache.keys()];
  }

  /** Change the token, as a bridge does after a restart. */
  renewToken() {
    this.token = `${this.token.slice(1)}${this.token[0]}`;
  }

  /** The answers to one request (several datagrams for a long list), or []. */
  handle(request) {
    this.received.push(request);
    if (!this.online) {
      return [];
    }
    if (this.drop > 0) {
      this.drop -= 1;
      return [];
    }
    switch (request.msgType) {
      case 'GetDeviceList':
        return this.deviceListReplies();
      case 'ReadDevice':
      case 'WriteDevice':
        return [this.deviceReply(request)];
      default:
        return [];
    }
  }

  deviceListReplies() {
    const { data, ...head } = this.fixture.deviceList;
    const entries = [...data, ...this.extraBlinds];
    const replies = [];
    let chunk = [];
    const datagram = (list) => ({ ...head, token: this.token, data: list });
    for (const entry of entries) {
      if (JSON.stringify(datagram([...chunk, entry])).length > 1000 && chunk.length > 0) {
        replies.push(datagram(chunk));
        chunk = [];
      }
      chunk.push(entry);
    }
    replies.push(datagram(chunk));
    return replies;
  }

  deviceReply(request) {
    const ackType = `${request.msgType}Ack`;
    if (request.AccessToken !== accessToken(this.key, this.token)) {
      return { msgType: ackType, mac: request.mac, actionResult: 'AccessToken error' };
    }
    if (request.mac === this.mac && !this.cache.has(request.mac)) {
      return clone(this.fixture.bridgeState ?? { msgType: ackType, mac: this.mac, data: {} });
    }
    const cached = this.cache.get(request.mac);
    if (!cached) {
      return { msgType: ackType, mac: request.mac, actionResult: 'device not exist' };
    }
    const answer = { ...clone(cached), msgType: ackType };
    if (request.msgType === 'WriteDevice') {
      this.command(request.mac, request.data ?? {});
    }
    return answer;
  }

  /** Apply a WriteDevice to the motor. */
  command(mac, data) {
    const motor = this.motors.get(mac);
    if (motor.wirelessMode === 0) {
      motor.operation = data.operation ?? motor.operation;
      this.report(mac);
      return;
    }
    const target = { ...this.targets.get(mac) };
    const set = (key, value) => {
      if (value !== undefined) {
        target[key] = value;
      }
    };
    switch (data.operation) {
      case 1:
        set('currentPosition', 0);
        break;
      case 0:
        set('currentPosition', 100);
        break;
      case 2:
        this.targets.delete(mac);
        motor.operation = 2;
        this.report(mac);
        return;
      case 5:
        // A status query: the motor reports what it does now.
        this.report(mac);
        return;
      case 12:
        set('currentPosition', 50);
        break;
      default:
        break;
    }
    set('currentPosition', data.targetPosition);
    set('currentAngle', data.targetAngle);
    set('currentPosition_B', data.targetPosition_B);
    set('currentPosition_T', data.targetPosition_T);
    if (data.operation_B === 2) {
      this.targets.delete(mac);
      this.report(mac);
      return;
    }
    if (data.operation_B === 5) {
      this.report(mac);
      return;
    }
    this.targets.set(mac, target);
    if (this.instant) {
      this.settle(mac);
    } else if (target.currentPosition !== undefined) {
      motor.operation = target.currentPosition < motor.currentPosition ? 1 : 0;
    }
  }

  /** One step of every moving motor (a quarter of the way), without a report. */
  step() {
    for (const [mac, target] of this.targets) {
      const motor = this.motors.get(mac);
      for (const [key, value] of Object.entries(target)) {
        const from = motor[key] ?? 0;
        const delta = value - from;
        motor[key] = Math.abs(delta) <= 25 ? value : from + Math.sign(delta) * 25;
      }
      if (Object.entries(target).every(([key, value]) => motor[key] === value)) {
        motor.operation = 2;
        this.targets.delete(mac);
      }
    }
  }

  /** The motor reaches its target and reports. */
  settle(mac) {
    const motor = this.motors.get(mac);
    Object.assign(motor, this.targets.get(mac) ?? {}, { operation: 2 });
    if (motor.operation_B !== undefined) {
      motor.operation_B = 2;
      motor.operation_T = 2;
    }
    this.targets.delete(mac);
    this.report(mac);
  }

  /** The motor reports: the bridge cache takes its state. */
  report(mac) {
    const cached = this.cache.get(mac);
    cached.data = clone(this.motors.get(mac));
  }

  /** Something outside Gladys (the remote) moved a blind, and it reported. */
  moveByRemote(mac, changes) {
    Object.assign(this.motors.get(mac), changes);
    this.report(mac);
  }

  /** How many requests of a type (and a command) the bridge received. */
  count(msgType, predicate = () => true) {
    return this.received.filter((request) => request.msgType === msgType && predicate(request))
      .length;
  }

  /** The answer to the discovery broadcast, as the Gladys core relays it. */
  scanReply() {
    const [reply] = this.online ? this.deviceListReplies() : [];
    return reply
      ? {
          source_ip: this.host,
          source_port: MOTION_PORT,
          payload_base64: Buffer.from(JSON.stringify(reply)).toString('base64'),
        }
      : null;
  }
}

/**
 * A UDP network of fake bridges.
 * @param {FakeBridge[]} bridges
 */
export function createNetwork(bridges) {
  const network = {
    bridges,
    sockets: [],
    byHost: (host) => network.bridges.find((bridge) => bridge.host === host),
    createSocket() {
      const socket = new EventEmitter();
      socket.bind = (port, callback) => setImmediate(callback);
      socket.unref = () => socket;
      socket.closed = false;
      socket.close = () => {
        socket.closed = true;
      };
      socket.send = (data, port, host, callback) => {
        setImmediate(() => callback?.(null));
        const bridge = network.byHost(host);
        if (!bridge || port !== MOTION_PORT) {
          return;
        }
        const replies = bridge.handle(JSON.parse(data.toString()));
        replies.forEach((reply, index) => {
          setTimeout(() => {
            if (!socket.closed) {
              socket.emit('message', Buffer.from(JSON.stringify(reply)), {
                address: host,
                port: MOTION_PORT,
              });
            }
          }, index);
        });
      };
      network.sockets.push(socket);
      return socket;
    },
    /** What the Gladys core would relay for a discovery broadcast. */
    scanReplies: () => network.bridges.map((bridge) => bridge.scanReply()).filter(Boolean),
  };
  return network;
}
