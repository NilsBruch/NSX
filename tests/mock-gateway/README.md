# Mock Gateway

A dependency-light stand-in for the Streamline-Bridge gateway, so the skin can
be developed and tested **without a DE1**.

It serves `packages/nsx/src` as the web root — exactly what the Decent app does
— and mocks the REST + WebSocket API on the same port.

```bash
npm run dev:gateway            # sync-core, then serve on http://localhost:8080
PORT=8090 npm run dev:gateway  # if the real Decent app already owns 8080
```

The same script also runs **without** the mock, for working against a real
machine — that is `npm run dev:nsx` (`--static`): it serves the skin on port
5174 and answers nothing under `/api/`, leaving the gateway to whoever owns
port 8080.

> **Port caveat.** `packages/core/src/config.js` derives the gateway host from
> `location.hostname` but **hardcodes port 8080**. On the default port
> everything just works. On any other port, open the skin with an explicit
> gateway, e.g. `http://localhost:8090/?gateway=http://localhost:8090`.

## Why it exists

Core changes used to be verifiable only against a live machine. The mock lets
us exercise the real code paths — including the ones that motivated recent
fixes — offline and deterministically.

## Faithful ETag behaviour

The ETag semantics were verified against a real gateway and are reproduced
exactly, because they are load-bearing for the cross-device refresh (issue #3):

| Endpoint | ETag / `304`? |
|---|---|
| `GET /api/v1/profiles` (incl. `?includeHidden=true`) | yes |
| `GET /api/v1/beans`, `/grinders`, `/shots` | yes |
| `GET /api/v1/store/<ns>?full=1` | yes |
| `GET /api/v1/store/<ns>/<key>` | **no** — deliberately, mirrors the real gateway |

That last row is the whole reason recipes and profile-favorites read through
the namespace-wide endpoint instead of per-key GETs.

## Simulated machine

- `PUT /api/v1/machine/state/<state>` switches state. Flowing states
  (`espresso`, `steam`, `hotWater`, `flush`) start a simulated shot: substate
  goes `preinfusion` → `pouring`, pressure/flow ramp up, and `profileFrame`
  advances one step every 6 s until the shot ends after ~45 s.
- `PUT /api/v1/machine/state/skipStep` advances `profileFrame` by one — this is
  what the cleaning "Step ↷" button drives.
- The machine-snapshot and scale WebSockets stream at 4 Hz; devices report both
  machine and scale as connected.

## Simulated updates

The skin's update card is built from `GET /api/v1/info`, `GET /api/v1/webui/skins`,
`POST /api/v1/webui/skins/update` and the two-way `ws/v1/update` channel — all
mocked. By default there is nothing to update, which is the normal answer and the
one the skin has to handle gracefully. Two env vars play the other side:

```bash
APP_UPDATE_TO=0.9.0 SKIN_UPDATE_TO=0.4.0 npm run dev:gateway
```

- `APP_UPDATE_TO` — `{"command":"check"}` on the socket then answers `available`
  with that version and `installable: true`, and `{"command":"install"}` runs a
  fake download (`downloading` with `progress` 0→1, then `installing`), so the
  progress bar is exercisable. Without it the channel answers `idle` and an
  `install` is refused with an `{error}` reply, matching a desktop gateway.
- `SKIN_UPDATE_TO` — the version every installed skin jumps to on the next
  `POST /webui/skins/update`, which is what makes the skin notice its on-disk
  version changed and reload.

Note that "is something newer published" is asked of **GitHub**, not of the mock
(see `packages/core/src/domains/update.js` for why), so the *badge* still reflects
real release tags even here — only the install paths are simulated.

## Simulated skins, pairings and network scales

`GET/PUT /webui/skins/default` switches which skin is served, and
`/webui/server/status` answers on a NEW port each time — the same behaviour the
real gateway has, and the reason a skin switcher has to read the port back
instead of reloading the URL it is on.

`PUT /devices/forget` drops a pairing: the device disappears from the REST list
and the WebSocket push until the server restarts, so "forget" can be told apart
from "disconnect" by hand. `GET/POST/DELETE /devices/wifi` keeps an in-process
list of network-scale hosts.

## Fixtures

`fixtures.mjs` seeds four profiles (one **hidden**, one cleaning profile), two
recipes (one referencing the hidden profile), beans, grinders, three shots, the
gateway's build info and two installed skins.
The hidden profile plus the recipe pointing at it exist so the hidden-profile
push path stays exercisable by hand.

State is mutated in-process, so a session behaves like a real one — changes
stick until the server restarts.
