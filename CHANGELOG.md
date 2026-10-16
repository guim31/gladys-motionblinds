# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Motionblinds blinds, shutters and curtains (and the sister brands on the same
  platform) driven locally through the Motion Wi-Fi bridge or Motion Wi-Fi
  motors, with the key of the Motion app. No cloud, no account.
- One Gladys device per blind: open / close / stop, the position, the slat tilt
  of venetian, Shangri-La and vertical blinds and double rollers, the top rail
  of top-down bottom-up blinds, the battery and its charge, the radio signal.
  Only what each motor can tell is published.
- Garage doors and roller gates are read-only unless the configuration allows
  them.
- The state follows the remote, the Motion app and the timers: the bridge's
  cache is read every 10 to 60 seconds, each two-way motor asked over the radio
  every 15 minutes, and a motor followed every few seconds after a command.
- Automatic discovery of the bridges through Gladys (Gladys 5.1 or later), or
  their IP addresses typed in the configuration.
- A "Search for bridges and blinds" action that also checks the key.
- A scene trigger, "Blind moved outside Gladys", and a scene action, "Go to the
  favorite position".
- A "Motion blinds" dashboard widget: every blind at a glance, low batteries,
  and open, stop or close them all.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-motionblinds/commits/main
