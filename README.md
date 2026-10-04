# BLACKGRID

**A cooperative blackout survival game.** Players search a city for power cells, restore three districts, and reach extraction while infected respond to sound, light, and repeated player routes. After victory, surviving crews can enter the shared Afterlight social room.

Live playtest: https://blackgrid-5obd.onrender.com  
Platform: desktop, phone, and tablet browsers with WebGL 2. Each operation supports up to 15 human players.

Player-facing documents: [Privacy Notice](https://blackgrid-5obd.onrender.com/privacy.html) and [Terms of Use](https://blackgrid-5obd.onrender.com/terms.html). These describe the current playtest and should be revised when accounts, analytics, moderation, or new data processing are introduced.

## Play

1. Open the live site or your own deployment and enter a callsign. Callsigns are temporary display names, not authenticated accounts.
2. Start an operation or enter a six-character room code.
3. Collect amber power cells, bring them to the central power station, restore the grid, and head south to extraction. Repeat for all three districts.
4. On a phone, rotate to landscape before deploying. The game blocks mission entry while the device is in portrait; some browsers cannot rotate automatically.
5. The circular microphone button in the HUD requests microphone permission on the first click. Click it again to mute. While live, your audio is sent to human players connected to the same operation; AI bots do not receive voice. Voice uses browser WebRTC and may not connect on networks that require a TURN relay.

## Controls

| Action | Desktop | Phone / tablet |
| --- | --- | --- |
| Move | WASD, toward the cursor | Left joystick |
| Aim | Mouse | Right aim pad |
| Fire / bite | Left mouse | FIRE / BITE button |
| Sprint | Hold Shift | Hold SPRINT |
| Interact | E | USE |
| Flashlight | F | LIGHT |
| Reload | R | LOAD |
| Heal | H | HEAL |
| Map | M | MAP |
| Camera | V | VIEW button |
| Voice | Click microphone in HUD to toggle live/muted | Tap microphone in HUD to toggle live/muted |
| Menu | Esc / MENU | MENU |

When your survivor becomes infected, the mobile attack control changes from **FIRE** to **BITE**. Human players who become infected are downed by gunfire and return as infected after the reanimation timer. An infected player who bites a survivor starts an irreversible infection countdown. AI infected killed during play are replenished away from the power-station safe-zone and the survivor spawn, so defending one spot cannot permanently clear the threat.

## Graphics and performance

Graphics presets are selected by the player and are never changed automatically. If frame rate stays low, BLACKGRID displays a notice recommending a desktop or a lower preset in Settings. The game is rendered on the player's own device; the hosting server runs the multiplayer simulation. Low server CPU can affect response smoothness and connection latency, while local device/browser/GPU limits affect rendered FPS.

The Render Free web-service tier is intended for trials and hobby projects. Render currently lists its free web service at 0.1 CPU and 512 MB RAM, sleeps after 15 minutes without inbound traffic, and can take about a minute to wake. This deployment is configured for one simultaneous operation (up to 15 players) as a conservative playtest. It is not load-tested or suitable as a promise of capacity for large public events. See [Render's free service limits](https://render.com/docs/free) and [compute plans](https://render.com/docs/compute-plans).

## Run locally

Requirements: Node.js 24 (Node.js 22 or newer is required by `package.json`).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. For production locally:

```sh
npm run build
npm start
```

The Node server serves the built client and WebSocket endpoint on `/socket`. It defaults to port 3000. Set `PORT` to change the port. Keep it bound to localhost unless you deliberately configure public hosting.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. Render uses `0.0.0.0`. |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `MAX_ROOMS` | `8` | Maximum simultaneous operation rooms on one server process. Each operation permits at most 15 human players. This is a software ceiling, not a capacity guarantee. |
| `PERSIST_LEARNING` | disabled unless `1` | Read/write bounded aggregate AI-adaptation counters. Render's ephemeral filesystem loses local writes on restarts and sleep. |
| `DATA_DIR` | `./data` | Directory for optional adaptation data when persistence is enabled. |
| `ALLOWED_ORIGINS` | empty | Comma-separated explicit origins only when a trusted reverse proxy changes the Host header. |
| `NODE_ENV` | unset | Use `production` for the built production server. |

`render.yaml` selects the Free web-service plan, Node 24, the health endpoint `/api/health`, and a one-room playtest limit. Render needs a public WebSocket-capable service. A temporary Cloudflare Quick Tunnel is not a permanent domain and does not point itself at Render.

## Architecture

- `src/` contains the browser client, Three.js renderer, interface, audio synthesis, and peer-to-peer voice.
- `server/` owns room state, movement, weapons, infection, AI, objectives, and WebSocket message validation.
- `shared/world.js` defines map geometry, weapons, and shared game constants.
- `public/` contains static media and interface assets.
- `tests/` contains simulation, networking, and browser/system checks.
- Client messages communicate player intent. The server decides movement and combat outcomes.
- Room chat and voice are temporary and scoped to the current operation/social room. Bots never receive browser voice streams.

## Visual direction

The interface uses an incident-record and municipal field-report art direction: warm paper, soot, and signal orange; a Georgia display face paired with plain Arial and compact field labels; thin rules and restrained motion. It avoids imported icon packs, web-font dependencies, glow, and automatic control movement. The game scene remains the primary artwork.

## Accounts, friends, and out-of-game chat

The current game has no Google or Apple OAuth, persistent player accounts, friend list, cross-room online-presence service, or separate global chat. A callsign is only a temporary room name. These features need an identity service, provider credentials and redirect URLs, durable storage, account-to-friend authorization, privacy controls, and abuse/rate protections. Google sign-in can be configured without a per-user fee, but the project still needs an OAuth client and a stable HTTPS callback domain. Apple sign-in requires Apple developer credentials and configuration; it cannot be enabled securely from this repository alone. Never put OAuth client secrets or database credentials in browser code or commit them to Git.

To add these features, first provision the HTTPS domain, database, and authentication provider. Then configure server-side secrets in the hosting dashboard and implement account linking, friends/presence APIs, and a separately scoped lobby chat. The existing room chat and Afterlight are not substitutes for persistent friends or global chat.

## Verification

```sh
npm run check          # Node simulation/network tests and production build
npm run test:browser   # Chrome UI, controls, multiplayer, and voice smoke test
npm run test:systems   # deterministic browser checks of gameplay progression
```

Browser tests use an installed Chrome and test-only fake microphone when requested by the test runner. They do not verify physical microphones, every mobile browser's orientation-lock behavior, TURN-relayed voice, or public-host load capacity.

## Safety and hosting notes

- Do not expose `npm run dev` to the public internet.
- Use `npm run build` and `npm start` behind a host that supports HTTPS and WebSocket upgrades.
- Room codes are join links, not access-control credentials. Do not share a private room code publicly.
- Voice starts muted. Browser microphone permission is requested only after the player clicks the microphone control.
- No player device is used as a game server or background worker without explicit opt-in.
- Free-host sleeping, restarts, monthly usage limits, and ephemeral file storage affect availability and persistence.
