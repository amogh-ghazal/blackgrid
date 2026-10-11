# BLACKGRID

BLACKGRID is a cooperative, browser-based survival game set in a city darkened by a cascading power failure. Crews recover power cells, restore three districts, and reach evacuation while infected react to noise, light, and survivor activity. Survivors who complete the operation can regroup in Afterlight, a shared social space.

**Live playtest:** [blackgrid-5obd.onrender.com](https://blackgrid-5obd.onrender.com)<br>
**Platforms:** desktop, phone, and tablet browsers with WebGL 2<br>
**Room size:** up to 15 human players per operation

Read the live [Privacy Notice](https://blackgrid-5obd.onrender.com/privacy.html) and [Terms of Use](https://blackgrid-5obd.onrender.com/terms.html) before playing.

## Play

1. Open the live site and sign in with Google. On the configured live deployment, sign-in is required; the Google profile name is used as the player name. Sessions use a secure, HTTP-only cookie and remain signed in until logout or session expiry.
2. Create an operation or select an active room. You can also join with its six-character room code.
3. Collect power cells and install them at the marked power station. Restore each district, then reach the southern evacuation point. There are three operations, each requiring three cells.
4. After completing the final operation, enter Afterlight to meet other survivors and use its room chat.
5. On phones and tablets, rotate to landscape before deploying. The game blocks mission entry in portrait mode; browser support for automatic rotation is limited.

The friends panel shows currently online players and lets you maintain a friend list. Friend IDs are stored in that browser's local storage; the list does not sync between devices. Presence is temporary and held in server memory, so it resets when the service restarts.

## Controls

| Action | Desktop | Phone / tablet |
| --- | --- | --- |
| Move | WASD; movement is oriented toward the cursor | Left joystick |
| Aim | Mouse | Right aim pad |
| Fire / bite | Left mouse | FIRE / BITE button |
| Sprint | Hold Shift | Hold SPRINT |
| Interact | E | USE |
| Flashlight | F | LIGHT |
| Reload | R | LOAD |
| Heal | H | HEAL |
| Map | M | MAP |
| Camera | V | VIEW button |
| Voice | Microphone button in the HUD | Microphone button in the HUD |
| Menu | Esc / MENU | MENU |

The attack control changes from **FIRE** to **BITE** when a survivor becomes infected. A human player killed while infected returns as an infected after the reanimation timer. AI infected killed during play are replenished away from the power-station safe zone and survivor spawn.

### Voice and chat

Voice starts muted. Select the microphone button to request browser microphone access and speak with human players in your current operation or Afterlight room. Audio uses peer-to-peer WebRTC; bots do not receive voice. Some restrictive networks may prevent voice connections because this deployment does not configure a TURN relay. Text chat is scoped to the current room and is not a persistent direct-message service.

## Game and hosting model

The Three.js scene and graphics run on each player's device. The Node.js server manages operation state, movement, combat, infected AI, objectives, and room communication. Graphics presets are player controlled and are not changed automatically. When frame rate is low, the game can suggest lowering the preset or using a desktop device.

The checked-in Render blueprint requests the Free web-service plan and sets a limit of **five simultaneous operation rooms**, with up to 15 human players per room. This is a configured software ceiling, not a tested load guarantee; five full rooms or 75 players are not guaranteed to run smoothly. Render's free services can sleep when idle and have resource limits. See [Render Free](https://render.com/docs/free) and [Render compute plans](https://render.com/docs/compute-plans). Rooms and online presence are in memory and do not survive a process restart. Optional AI adaptation persistence is disabled in the Render blueprint, and Render's local filesystem is ephemeral.

The current live playtest is hosted at the Render URL above. A Cloudflare Quick Tunnel is temporary and does not automatically route to Render.

## Run locally

Requirements: Node.js 22 or newer (the deployment blueprint pins Node 24.21.0).

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To run the built production server locally:

```sh
npm run build
npm start
```

The server serves the built client and WebSocket endpoint at `/socket`. It defaults to port 3000. Set `PORT` to select another port. The local development mode does not require Google sign-in unless `AUTH_REQUIRED=1` is set.

## Configuration

| Variable | Default / Render value | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` / `0.0.0.0` | HTTP server bind address. |
| `PORT` | `3000` / host provided | HTTP and WebSocket port. |
| `MAX_ROOMS` | `5` on Render | Maximum operation rooms in one server process; not a capacity guarantee. Each operation allows at most 15 human players. |
| `AUTH_REQUIRED` | `0` unless enabled / `1` on Render | Require a signed-in Google account to join. |
| `AUTH_SESSION_SECRET` | required in production | Private secret used to sign login sessions. Set this in the hosting dashboard; never commit it or expose it in browser code. |
| `PERSIST_LEARNING` | enabled unless `0` / `0` on Render | Persist bounded, aggregate AI-adaptation counters. File persistence is unsuitable for ephemeral hosting. |
| `DATA_DIR` | `./data` | Directory for optional adaptation data when persistence is enabled. |
| `ALLOWED_ORIGINS` | unset | Explicit comma-separated origins for a trusted reverse-proxy setup that changes the Host header. |
| `NODE_ENV` | unset / `production` on Render | Runtime mode. |

Google sign-in uses the web OAuth client ID configured in the client and server source. To run a separate public deployment, configure that OAuth client with the deployment's authorized JavaScript origin and redirect URI, and update the client ID in both locations. The production server also needs a strong `AUTH_SESSION_SECRET` configured as a private environment variable. Never commit OAuth client secrets, session secrets, or database credentials.

`render.yaml` defines a Free Node web service, builds with `npm ci && npm run build`, starts with `npm start`, and checks `/api/health`. It configures production mode, five rooms, required Google sign-in, and disabled learning persistence. WebSocket upgrades must be supported by the host.

## Architecture

- `src/` contains the browser client, Three.js renderer, interface, synthesized audio, and WebRTC voice.
- `server/` owns room state, movement, weapons, infection, AI, objectives, authentication, and WebSocket message validation.
- `shared/world.js` defines map geometry, weapons, and shared game constants.
- `public/` contains static media and interface assets.
- `tests/` contains simulation, networking, browser, and system checks.
- Client messages express player actions; the server validates and resolves gameplay outcomes.
- Google identity is verified server-side. Signed sessions use secure, HTTP-only cookies. The current implementation has no durable player profile or saved progression database.
- Online presence is in memory. Friend IDs are stored locally in the signed-in browser. Room chat and voice are temporary and room scoped.

## Verification

```sh
npm run check          # Node simulation/network tests and production build
npm run test:browser   # Chrome UI, controls, multiplayer, and voice smoke test
npm run test:systems   # deterministic browser checks of gameplay progression
```

Browser checks require an installed Chrome. Automated runs do not verify physical microphones, every mobile browser's orientation behavior, TURN-relayed voice, or public-host capacity.

## Safety and operations

- Do not expose `npm run dev` directly to the public internet.
- Use the production build behind HTTPS and a host that supports WebSocket upgrades.
- Room codes are join links, not access-control credentials; avoid sharing private room codes publicly.
- Voice starts muted and browser microphone permission is requested only after player interaction.
- Do not use secrets in client code or commit them to Git.
- Free hosting may sleep, restart, enforce resource limits, and use ephemeral storage. Plan around those limits for availability and persistence.
