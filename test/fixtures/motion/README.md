# Motion protocol fixtures

What a Motion bridge (or a Motion Wi-Fi motor) answers on UDP port 32100, one
file per device: its `GetDeviceListAck`, and the `ReadDeviceAck` of each blind.
`test/helpers/fakeBridge.js` serves them and applies the commands.

No capture of a real bridge was available when this integration was written
(developed without the hardware). The messages are rebuilt from public sources:

- the `GetDeviceListAck` of the
  [motionblinds](https://github.com/starkillerOG/motion-blinds) README (MIT) and
  of the Home Assistant `motion_blinds` tests (Apache-2.0): message type, MAC,
  device types, `ProtocolVersion` 0.9, the sample token `12345A678B9CDEFG`;
- the fields of `ReadDeviceAck.data` the motionblinds library parses
  (`type`, `operation`, `currentPosition`, `currentAngle`, `currentState`,
  `voltageMode`, `batteryLevel` in hundredths of a volt, `chargingState`,
  `wirelessMode`, `RSSI`, and their `_T` / `_B` forms for a top-down bottom-up
  blind), with values in the ranges its README and code show (a 3-cell pack at
  11.95 V, an RSSI of -71 dBm...).

Every MAC address and token here is invented. Replace a file with a real
capture (`scripts/probe.mjs` prints one, anonymized) whenever one is available.
