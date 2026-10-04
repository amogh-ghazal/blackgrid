# BLACKGRID

Windows project root: D:\blackgrid.
Portable Node is installed in tools/node-v24.21.0-win-x64; add that directory to the process PATH when Node is not installed globally.
Run npm run dev for Vite middleware and the WebSocket server on port 3000.
Run npm test for authoritative simulation and network integration tests.
Run npm run build and npm start for the production server.
Run npm run test:browser for the Chrome smoke test; set CHROME_PATH if Chrome is not at the Windows default path.
Run node tests/browser-systems.js after a production build for deterministic browser coverage of pickups, driving, healing, all campaign stages, infection, and restart. It starts an isolated ephemeral test server.
Browser test captures are in artifacts. Browser checks use installed Chrome, not a downloaded browser.
State snapshots use application-level gzip binary frames when the client advertises binaryState; JSON control messages and plain JSON snapshots remain supported. Browser decoding is ordered. This reduces bandwidth even when a tunnel strips WebSocket compression extensions.
Production hosting requires WebSocket upgrade support on /socket. Set HOST=0.0.0.0 only when intentionally exposing the host. PORT defaults to 3000 and MAX_ROOMS defaults to 8.
Set ALLOWED_ORIGINS to explicit comma-separated browser origins only if a trusted reverse proxy changes the Host header. DATA_DIR selects persistent anonymous adaptation storage; PERSIST_LEARNING=0 disables it.
Use original procedural assets, bundled dependencies, and no paid runtime APIs.
The server owns player position, combat, inventory, infection, objectives, and bounded learning. Clients send intentions only.
Never silently consume peer compute. Volunteer hosting requires an explicit operator, and separate hosts do not share trust or state.
Portable cloudflared 2026.9.3 is in tools/cloudflared.exe, verified against the GitHub release SHA-256. start-public-playtest.cmd creates an anonymous, public, temporary Cloudflare Quick Tunnel to an already-running production server. Closing it removes public access; it is not permanent cloud hosting. Never expose the development server with this launcher.
