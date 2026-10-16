# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **The key of the Motion app** (16 characters): it lets anyone on the local
  network move every blind of the account. It is stored by Gladys in the
  integration configuration (a `secret` field, never sent back to the
  browser), and only used in the container to compute the `AccessToken` of
  each request. It is never written to `/data` nor to the logs, and neither is
  the bridge's token nor the `AccessToken`.
- **`/data`** holds `motionblinds-state.json`: the IP addresses and MAC
  addresses of the bridges and blinds already seen, and what each motor
  reported about itself (type, radio mode, battery). No secret.
- **Network**: UDP port 32100, in unicast, towards the bridge addresses typed in
  the configuration or found by the discovery; the discovery broadcast is
  emitted by the Gladys core (`network_discovery`, port 32100 only). No
  Internet access, no listening port.
- **Garage doors and gates** are read-only unless the user allows them in the
  configuration.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Motion bridges and motors, their firmware and their app, and the local
protocol itself (unencrypted UDP on the local network, by design of the
manufacturer).
