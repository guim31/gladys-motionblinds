# Motionblinds for Gladys Assistant

Drive **Motionblinds** blinds, shutters and curtains (Coulisse) and their sister brands sold in Europe (Brel Home,
Bloc Blinds, Dooya, Acmeda Automate Pulse 2...) from [Gladys Assistant](https://gladysassistant.com), **locally**,
through the **Motion Wi-Fi bridge** (CM-20, CM-32...) or Motion Wi-Fi motors. No cloud, no account: the
integration speaks the bridge's UDP protocol on your network, like the Motion app.

> **Developed without the hardware: feedback welcome.** The integration was written from the protocol as the
> [motionblinds](https://github.com/starkillerOG/motion-blinds) library and Home Assistant use it, and tested
> against a simulated bridge only. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-motionblinds/issues).

## Features

- **One Gladys device per blind**, in the shutter category (the curtain category for curtains):
  - **Open / close**: open, stop, close, and whether it is open, closed, stopped or moving;
  - **Position** (0 % = closed, 100 % = open, like every Gladys shutter);
  - **Slat tilt** of venetian, Shangri-La and vertical blinds and double rollers, as a second slider;
  - **Top rail position** of top-down bottom-up blinds;
  - **Battery** and **Charging** of battery motors, **Radio signal** of two-way motors.
- Only what a motor can tell is published: a one-way motor gets open / close only, a motor that knows its end limits
  only gets no position.
- **Garage doors and gates are read-only** unless the configuration allows them, and the widget never moves them.
- A **scene trigger**, "Blind moved outside Gladys" (remote, Motion app, timer, sun sensor), with the direction and
  the new position.
- A **scene action**, "Go to the favorite position" stored in the motor.
- A **dashboard widget**, "Motion blinds": every blind at a glance, low batteries, the blinds that no longer answer,
  and open / stop / close all.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1** or later.
- A Motion Wi-Fi bridge (or Motion Wi-Fi motors) set up in the Motion app, on the same network as Gladys.
- The **key** of the Motion app: Motion app → ⋮ → Settings → tap the "About" page five times (16 characters with
  dashes). The [documentation](docs/en.md) shows the steps.

## Installation

In Gladys, open **Integrations**, then **Install from GitHub**, and enter the address of this repository:

```
https://github.com/guim31/gladys-motionblinds
```

In the **Configuration** tab, enter the IP address of the bridge and the key, run **Search for bridges and blinds**,
then open the **Discovery** tab and add the blinds. The documentation details every option:
[English](docs/en.md), [Français](docs/fr.md), [Deutsch](docs/de.md), [Español](docs/es.md).

## How it works

- The integration runs in its own container on a private Docker network. **Unicast** UDP crosses it both ways, so
  the integration sends its requests (port 32100) straight to the bridge and gets the answers.
- **Multicast does not cross it**: the pushes of the bridge (238.0.0.18, port 32101) never reach the container. So
  the integration reads the bridge's cache of each blind added to Gladys at the refresh interval (30 s by default, no
  radio traffic), asks each two-way motor for its state over the radio every 15 minutes, and follows a motor every
  5 s after a command until it stops. It polls by its own timer; Gladys's polling is only a fallback (Gladys#3198).
- **Discovery**: with no address typed, the integration asks the Gladys core to broadcast a `GetDeviceList` on
  port 32100 (mediated discovery, `udp-active-broadcast`) and reads the answers. A bridge that only answers the
  multicast group is not found that way: its address is typed in the configuration.
- **The key** turns the bridge's token into the `AccessToken` of each request (AES-128). It stays in the Gladys
  configuration; neither it nor the token is written to `/data` or to the logs.
- `/data` keeps the bridges and blinds already seen (address, type, what each motor reported about itself), so a
  restart publishes the same devices before the bridge answers.

## Checked, and what was not

Checked:

- every blind kind of the fixtures (battery and mains roller blinds, venetian blind, curtain, one-way roller
  shutter, roller gate, top-down bottom-up blind, double roller, limits-only motor, Wi-Fi curtain and garage door
  motors) against the rules of the Gladys core (feature couples, bounds, units, poll frequencies) in the four
  languages;
- the whole integration against the fake Gladys of the SDK and a simulated bridge that checks the `AccessToken`,
  renews its token, loses datagrams, splits a long device list and moves its motors;
- the `AccessToken` against an independent computation (OpenSSL);
- `scripts/probe.mjs` with real UDP sockets against the simulated bridge.

Not checked, for want of hardware or of a Gladys instance:

- a real Motion bridge or motor: the exact answers of each firmware, the `actionResult` texts, the timing of a real
  motor's reports, the battery and signal values of real motors;
- whether a bridge answers the discovery broadcast relayed by a real Gladys core;
- the rendering of the widget and of the scene cards in the Gladys interface.

`node scripts/probe.mjs <bridge IP> <key> [--raw]` reads a real bridge without moving anything (no command is
sent) and prints what the integration would publish; `--raw` prints the answers, anonymized, ready to become a test
fixture.

## Limitations

- Changes made outside Gladys are seen at the next reading (10 to 60 s), not instantly.
- Top-down bottom-up and triangle blinds, double rollers and Wi-Fi garage doors are supported from the library's
  protocol notes but untested.
- The slat tilt is a second position slider (Gladys has no tilt feature).
- One-way motors report nothing: Gladys shows the last command sent.
- The bridge's own Wi-Fi signal and the motors' limit settings are not exposed.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The architecture, the protocol notes and the pitfalls are in [CLAUDE.md](CLAUDE.md). Releases are made by the
**Release** workflow (Actions → Release): never edit the versions by hand.

## Credits

- [motionblinds](https://github.com/starkillerOG/motion-blinds) (MIT License, © 2020 starkillerOG): the protocol,
  the device and blind types, the parsing of the answers, the battery formula, the key procedure, and the sample
  messages used for the test fixtures.
- The [Home Assistant Motionblinds integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/motion_blinds)
  (Apache License 2.0): the mapping of blind types to covers, the polling and follow-up choices, the sample device
  list of its tests.
- Built from the official [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is **not affiliated with Coulisse / Motionblinds**, nor endorsed by them. Motionblinds is a trademark of
Coulisse B.V.; the other brands named belong to their owners.

## License

[Apache License 2.0](LICENSE).
