// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { MotionHub } from './hub.js';
import { MotionTransport } from './motion/transport.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED, searchMessage } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'motionblinds-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, createSocket, port, timers,
 *   timings, transportTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const transport = new MotionTransport({
    createSocket: options.createSocket,
    port: options.port,
    timings: options.transportTimings,
    logger: createLogger({ name: 'motionblinds-udp' }),
  });
  const hub = new MotionHub({
    gladys,
    store: options.store ?? new Store(),
    transport,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first search is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The hub reads the blinds by its own timer; this only serves a Gladys
  // that polls them too, and skips a blind the timer just read.
  gladys.onPoll(whenReady((device) => hub.pollFromCore(device)));

  // A device added or updated by the user: Gladys dropped the states sent
  // before, and the SDK forgot them; read the blind and send them now.
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => searchMessage(await hub.search())),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
