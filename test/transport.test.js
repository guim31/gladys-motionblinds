// -----------------------------------------------------------------------------
// The UDP transport: one exchange at a time per bridge, sent again when a
// datagram is lost, long answers in several datagrams, errors of the bridge.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionTransport } from '../src/motion/transport.js';
import { FakeBridge, createNetwork } from './helpers/fakeBridge.js';
import { BRIDGE, FAST_TRANSPORT } from './helpers/world.js';
import { getDeviceListRequest } from '../src/motion/protocol.js';

function setup() {
  const bridge = new FakeBridge(BRIDGE, '192.0.2.20');
  const network = createNetwork([bridge]);
  const transport = new MotionTransport({
    createSocket: network.createSocket,
    timings: FAST_TRANSPORT,
  });
  return { bridge, network, transport };
}

test('a lost datagram is sent again', async () => {
  const { bridge, transport } = setup();
  bridge.drop = 1;
  const [answer] = await transport.request('192.0.2.20', getDeviceListRequest(), {
    multiple: true,
  });
  assert.equal(answer.msgType, 'GetDeviceListAck');
  assert.equal(bridge.count('GetDeviceList'), 2);
});

test('a bridge that never answers is unreachable after the deadline', async () => {
  const { bridge, transport } = setup();
  bridge.online = false;
  await assert.rejects(transport.request('192.0.2.20', getDeviceListRequest()), (err) => {
    assert.equal(err.kind, 'timeout');
    assert.equal(err.unreachable, true);
    return true;
  });
  await assert.rejects(transport.request('192.0.2.99', getDeviceListRequest()), /did not answer/);
});

test('a long device list comes in several datagrams, all collected', async () => {
  const { bridge, transport } = setup();
  for (let index = 10; index < 40; index += 1) {
    bridge.extraBlinds.push({ mac: `0a0b0c0d0e0f00${index}`, deviceType: '10000000' });
  }
  const answers = await transport.request('192.0.2.20', getDeviceListRequest(), {
    multiple: true,
  });
  assert.ok(answers.length >= 2, `${answers.length} datagram(s)`);
  const total = answers.reduce((sum, answer) => sum + answer.data.length, 0);
  assert.equal(total, 1 + 8 + 30);
});

test('an actionResult is a refusal, with the token it may carry', async () => {
  const { network, transport } = setup();
  const socket = network.createSocket;
  network.createSocket = () => {
    const created = socket();
    created.send = (data, port, host, callback) => {
      callback?.(null);
      setImmediate(() =>
        created.emit(
          'message',
          Buffer.from(
            JSON.stringify({
              msgType: 'WriteDeviceAck',
              actionResult: 'AccessToken error',
              token: 'T',
            }),
          ),
          { address: host, port },
        ),
      );
    };
    return created;
  };
  transport.createSocket = network.createSocket;
  await assert.rejects(transport.request('192.0.2.20', { msgType: 'WriteDevice' }), (err) => {
    assert.equal(err.kind, 'refused');
    assert.equal(err.actionResult, 'AccessToken error');
    assert.equal(err.token, 'T');
    assert.equal(err.unreachable, false);
    return true;
  });
});

test('requests to one bridge run one at a time, in order', async () => {
  const { bridge, transport } = setup();
  const order = [];
  const handle = bridge.handle.bind(bridge);
  bridge.handle = (request) => {
    order.push(request.msgID);
    return handle(request);
  };
  await Promise.all(
    ['1', '2', '3'].map((id) =>
      transport.request('192.0.2.20', { msgType: 'GetDeviceList', msgID: id }, { multiple: true }),
    ),
  );
  assert.deepEqual(order, ['1', '2', '3']);
});

test('closing aborts the exchanges in progress', async () => {
  const { bridge, transport } = setup();
  bridge.online = false;
  const pending = transport.request('192.0.2.20', getDeviceListRequest());
  setImmediate(() => transport.close());
  await assert.rejects(pending, /stopping/);
  await assert.rejects(transport.request('192.0.2.20', getDeviceListRequest()), /stopping/);
});
