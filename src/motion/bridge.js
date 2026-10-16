// -----------------------------------------------------------------------------
// One Motion bridge (or Motion Wi-Fi motor) at one address: its device list,
// its token, and the reads and writes of its blinds.
//
// The token comes with every GetDeviceListAck and may change (the bridge
// restarted, or renews it). A ReadDevice or WriteDevice built on an old token,
// or on a wrong key, is answered with an `actionResult` error: the token is
// asked again and the request sent once more. A second refusal with a fresh
// token means the key is wrong.
// -----------------------------------------------------------------------------

import {
  getDeviceListRequest,
  parseBlindState,
  parseDeviceList,
  readDeviceRequest,
  writeDeviceRequest,
} from './protocol.js';
import { MotionError } from './transport.js';

// What the bridges are known to answer to a bad AccessToken ("AccessToken
// error"); any other refusal is reported as it is.
const KEY_ERROR = /token|key|auth/i;

export class MotionBridge {
  /**
   * @param {object} options
   * @param {string} options.host IPv4 address
   * @param {object} options.transport MotionTransport
   * @param {() => string} options.getKey the current key of the configuration
   */
  constructor({ host, transport, getKey }) {
    this.host = host;
    this.transport = transport;
    this.getKey = getKey;
    this.token = null;
  }

  /** GetDeviceList: the bridge itself and its blinds (see parseDeviceList). */
  async getDeviceList() {
    const replies = await this.transport.request(this.host, getDeviceListRequest(), {
      multiple: true,
    });
    const list = parseDeviceList(replies);
    if (!list) {
      throw new MotionError(`${this.host} is not a Motion bridge`, { kind: 'invalid' });
    }
    if (list.token) {
      this.token = list.token;
    }
    return list;
  }

  /** The cached state of a blind (no radio traffic). */
  read(blind) {
    return this.withToken((token) =>
      this.transport.request(this.host, () =>
        readDeviceRequest({ ...blind, token, key: this.getKey() }),
      ),
    );
  }

  /**
   * A command to a blind; resolves with the state the bridge answers (its
   * cache, before the motor moved).
   */
  write(blind, data) {
    return this.withToken((token) =>
      this.transport.request(this.host, () =>
        writeDeviceRequest({ ...blind, token, key: this.getKey() }, data),
      ),
    );
  }

  async withToken(send) {
    if (!this.token) {
      await this.getDeviceList();
    }
    let reply;
    try {
      reply = await send(this.token);
    } catch (err) {
      if (!(err instanceof MotionError) || err.kind !== 'refused') {
        throw err;
      }
      // An old token: take the new one (sent with the error, or asked).
      if (err.token && err.token !== this.token) {
        this.token = err.token;
      } else {
        await this.getDeviceList();
      }
      try {
        reply = await send(this.token);
      } catch (again) {
        if (again instanceof MotionError && again.kind === 'refused') {
          again.keyRejected = KEY_ERROR.test(again.actionResult ?? '');
        }
        throw again;
      }
    }
    return { reply, state: parseBlindState(reply) };
  }
}
