// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the
// bridges and of Gladys and one line per user action, never one line per
// reading, a repeated failure once — and never the key, the token or the
// AccessToken, even at the debug level. Also: the hub reads the blinds by its
// own timer, without any onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { accessToken } from '../src/motion/protocol.js';
import {
  MACS,
  TEST_KEY,
  createAll,
  createWorld,
  discovered,
  featureId,
  lastState,
} from './helpers/world.js';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  // Only the log lines ([timestamp] [LEVEL] ...): the test runner reports
  // through the same stdout, and its lines must still reach it.
  const writer = (stream) => {
    const original = stream.write.bind(stream);
    return (chunk, ...rest) => {
      const text = String(chunk);
      if (!/^\[\d{4}-\d{2}-\d{2}T/.test(text)) {
        return original(chunk, ...rest);
      }
      lines.push(...text.split('\n').filter(Boolean));
      return true;
    };
  };
  const stdout = t.mock.method(process.stdout, 'write', writer(process.stdout));
  const stderr = t.mock.method(process.stderr, 'write', writer(process.stderr));
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('logs: normal readings, with changes, write nothing at the info level', async (t) => {
  const w = await createdWorld(t);
  const lines = await capture(t, async () => {
    for (const position of [20, 40, 60, 60]) {
      w.bridges[0].moveByRemote(MACS.curtain, { currentPosition: position });
      await w.poll();
    }
    w.clock.advance(15 * 60_000);
    await w.poll();
    await w.hub.rediscover();
    await w.hub.idle();
  });
  assert.equal(lastState(w, MACS.curtain, 'position'), 40);
  assert.deepEqual(lines, []);
});

test('logs: one line per user action', async (t) => {
  const w = await createdWorld(t);
  const lines = await capture(t, async () => {
    await w.fake.setValue(
      discovered(w, MACS.roller),
      { external_id: featureId(w.gladys, MACS.roller, 'position') },
      40,
    );
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Roller blind 0a0b0c0d0e0f0001: position 40/);
});

test('logs: Gladys refusing the states is said once, and its return once', async (t) => {
  const w = await createdWorld(t);
  const refusal = t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const position of [20, 30, 40, 50]) {
      w.bridges[0].moveByRemote(MACS.curtain, { currentPosition: position });
      await w.hub.track(w.poll());
      await w.hub.idle();
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Gladys does not take the Motionblinds updates/);

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await w.poll();
    await w.poll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Motionblinds updates again/);
});

test('logs: a bridge down is said once, its return once', async (t) => {
  const w = await createdWorld(t);
  w.bridges[0].online = false;
  const down = await capture(t, async () => {
    for (let round = 0; round < 5; round += 1) {
      await w.poll();
    }
  });
  assert.equal(down.length, 1, down.join('\n'));
  assert.match(down[0], /\[INFO\].*Motion bridge at 192\.0\.2\.20 does not answer/);
  w.bridges[0].online = true;
  const back = await capture(t, async () => {
    await w.poll();
    await w.poll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*answers again/);
});

test('logs: a refused key is said once, not at every reading', async (t) => {
  const w = await createdWorld(t);
  const lines = await capture(t, async () => {
    w.bridges[0].key = 'ffffffff-eeee-dd';
    for (let round = 0; round < 4; round += 1) {
      await w.poll();
    }
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*refused the key/);
});

test('logs: never the key, the token or the AccessToken, even in debug', async (t) => {
  const lines = await capture(
    t,
    async () => {
      const w = await createdWorld(t, { config: { language: 'fr' } });
      await w.fake.setValue(
        discovered(w, MACS.roller),
        { external_id: featureId(w.gladys, MACS.roller, 'state') },
        1,
      );
      w.bridges[0].renewToken();
      await w.poll();
      await w.fake.action('search', {});
      w.bridges[0].key = 'ffffffff-eeee-dd';
      await w.poll();
    },
    'debug',
  );
  assert.ok(lines.length > 5, 'the debug level shows the details');
  const text = lines.join('\n');
  const token = '12345A678B9CDEFG';
  for (const secret of [
    TEST_KEY,
    token,
    accessToken(TEST_KEY, token),
    accessToken(TEST_KEY, `${token.slice(1)}${token[0]}`),
  ]) {
    assert.ok(!text.includes(secret), `a secret is in the logs: ${secret}`);
  }
});

test('polling: the hub reads by its own timer, without any onPoll', async (t) => {
  // Only the intervals are simulated: the UDP deadlines keep their real timers.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const w = await createdWorld(t, { timers: true });
  const onPoll = t.mock.method(w.hub, 'pollFromCore');
  const reads = t.mock.method(w.hub, 'refresh');

  w.bridges[0].moveByRemote(MACS.curtain, { currentPosition: 0 });
  w.clock.advance(29_000);
  t.mock.timers.tick(29_000);
  await w.hub.idle();
  assert.equal(reads.mock.callCount(), 0, 'not before the interval');
  w.clock.advance(1_000);
  t.mock.timers.tick(1_000);
  await w.hub.idle();
  assert.ok(reads.mock.callCount() >= 1);
  assert.equal(onPoll.mock.callCount(), 0);
  assert.equal(lastState(w, MACS.curtain, 'position'), 100);
});
