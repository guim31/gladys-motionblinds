// -----------------------------------------------------------------------------
// UDP exchanges with a Motion bridge (or a Motion Wi-Fi motor), in unicast:
// unicast crosses the NAT of the integration's Docker bridge in both
// directions, multicast and broadcast do not (see src/discovery.js).
//
// One socket per request, bound on an ephemeral port, like the motionblinds
// library does: whatever comes back from the bridge on it is the answer. One
// request at a time per bridge, which handles one at a time anyway (Home
// Assistant holds a lock for the same reason). UDP loses datagrams, so a
// request is sent again until the answer or the deadline; a command sent
// twice is harmless (a target position, open, close, stop).
//
// A long answer (a GetDeviceListAck with many blinds) comes in several
// datagrams: while a datagram is nearly 1 KB, the next one is awaited a short
// while.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { MAX_DATAGRAM, MOTION_PORT } from './protocol.js';

export const TRANSPORT_TIMINGS = {
  // Total wait for an answer.
  timeoutMs: 6_000,
  // Delay before sending the same request again.
  retryMs: 2_000,
  // Wait for the rest of a long answer.
  continuationMs: 300,
};

export class MotionError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {'timeout'|'socket'|'refused'|'invalid'} [details.kind]
   * @param {string} [details.actionResult] the bridge's error text
   * @param {string} [details.token] a new token sent with the error
   */
  constructor(message, { kind = 'invalid', actionResult, token } = {}) {
    super(message);
    this.name = 'MotionError';
    this.kind = kind;
    this.actionResult = actionResult;
    this.token = token;
  }

  /** The bridge did not answer at all. */
  get unreachable() {
    return this.kind === 'timeout' || this.kind === 'socket';
  }
}

export class MotionTransport {
  /**
   * @param {object} [options]
   * @param {() => object} [options.createSocket] test seam: a dgram-like socket
   * @param {number} [options.port] destination port of the bridges
   * @param {object} [options.timings] TRANSPORT_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({ createSocket, port = MOTION_PORT, timings, logger } = {}) {
    this.createSocket = createSocket ?? (() => dgram.createSocket('udp4'));
    this.port = port;
    this.timings = { ...TRANSPORT_TIMINGS, ...timings };
    this.logger = logger;
    /** @type {Map<string, Promise>} tail of the requests of each bridge */
    this.queues = new Map();
    /** @type {Set<Function>} aborts of the exchanges in progress */
    this.inFlight = new Set();
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const abort of this.inFlight) {
      abort();
    }
    this.inFlight.clear();
  }

  /**
   * Send one message to a bridge and resolve with its answer(s).
   * @param {string} host IPv4 address of the bridge
   * @param {object|(() => object)} message the JSON message, or a function
   *   building it when its turn comes (the AccessToken depends on the token
   *   known then)
   * @param {object} [options]
   * @param {string} [options.expect] the msgType of the answer (default: msgType + 'Ack')
   * @param {boolean} [options.multiple] collect a long answer in several datagrams
   * @returns {Promise<object|object[]>} the answer, or every datagram of it
   */
  request(host, message, options = {}) {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous.then(() =>
      this.exchange(host, typeof message === 'function' ? message() : message, options),
    );
    const tail = run.catch(() => {});
    this.queues.set(host, tail);
    tail.then(() => {
      if (this.queues.get(host) === tail) {
        this.queues.delete(host);
      }
    });
    return run;
  }

  async exchange(host, message, { expect = `${message.msgType}Ack`, multiple = false } = {}) {
    if (this.closed) {
      throw new MotionError('The integration is stopping', { kind: 'socket' });
    }
    const data = Buffer.from(JSON.stringify(message));
    const answers = [];
    const outcome = await new Promise((resolve) => {
      let socket = null;
      let retryTimer = null;
      let deadline = null;
      let continuation = null;
      let done = false;
      const finish = (result) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(retryTimer);
        clearTimeout(deadline);
        clearTimeout(continuation);
        this.inFlight.delete(abort);
        try {
          socket?.close();
        } catch {
          // Already closed.
        }
        socket = null;
        resolve(result);
      };
      const abort = () => finish({ closed: true });
      this.inFlight.add(abort);

      const send = () => {
        if (done) {
          return;
        }
        socket.send(data, this.port, host, (err) => {
          if (err) {
            this.logger?.debug(`Cannot send ${message.msgType} to ${host}: ${err.message}`);
          }
        });
        retryTimer = setTimeout(send, this.timings.retryMs);
      };
      const onMessage = (raw, remote) => {
        if (remote?.address !== host) {
          return;
        }
        let decoded;
        try {
          decoded = JSON.parse(raw.toString('utf8'));
        } catch {
          this.logger?.debug(`Ignored a datagram that is not JSON from ${host}`);
          return;
        }
        if (!decoded || typeof decoded !== 'object') {
          return;
        }
        if (decoded.actionResult !== undefined) {
          finish({ error: decoded });
          return;
        }
        if (decoded.msgType !== expect) {
          return;
        }
        answers.push(decoded);
        clearTimeout(retryTimer);
        clearTimeout(continuation);
        if (multiple && raw.length >= 0.9 * MAX_DATAGRAM) {
          // More may follow: wait a little for it.
          continuation = setTimeout(() => finish({ ok: true }), this.timings.continuationMs);
        } else {
          finish({ ok: true });
        }
      };

      try {
        socket = this.createSocket();
      } catch (err) {
        finish({ socketError: err });
        return;
      }
      socket.on('message', onMessage);
      // `on`, not `once`: a late error must never be an unhandled event.
      socket.on('error', (err) => finish({ socketError: err }));
      deadline = setTimeout(
        () => finish(answers.length > 0 ? { ok: true } : { timeout: true }),
        this.timings.timeoutMs,
      );
      socket.bind(0, () => {
        socket?.unref?.();
        send();
      });
    });

    if (outcome.closed) {
      throw new MotionError('The integration is stopping', { kind: 'socket' });
    }
    if (outcome.socketError) {
      throw new MotionError(`UDP socket error: ${outcome.socketError.message}`, { kind: 'socket' });
    }
    if (outcome.timeout) {
      throw new MotionError(`${host} did not answer ${message.msgType}`, { kind: 'timeout' });
    }
    if (outcome.error) {
      const actionResult = String(outcome.error.actionResult);
      throw new MotionError(`${host} refused ${message.msgType}: ${actionResult}`, {
        kind: 'refused',
        actionResult,
        token: typeof outcome.error.token === 'string' ? outcome.error.token : undefined,
      });
    }
    return multiple ? answers : answers[0];
  }
}
