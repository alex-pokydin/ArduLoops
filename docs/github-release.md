# GitHub release — ArduLoops 1.0.0

Paste this as the release body. Tag: `1.0.0`. Title: `ArduLoops 1.0.0`.

Attach (after `npm run build`):

- `ArduLoops_1.0.0_x64-setup.exe`
- `ArduLoops_1.0.0_x64_en-US.msi`

from `src-tauri/target/release/bundle/nsis/` and `…/bundle/msi`.

---

**ArduLoops 1.0.0** — Plane loops and in-app SITL.

HEARTBEAT mounts **copter** or **plane**. The stand starts SITL from the left rail.

### What's in 1.0.0

- **Plane** — Map (L1, TECS, separate roll/pitch cards, yaw damper, ground steer), Loop schemes (rate PID + FF, L1, TECS energy), Scope.
- **SITL** — Start/stop from the app (official sitl-exe), copter/plane thumbs, speedup, wind and GPS when the sim is live. Link `tcpout:127.0.0.1:5770`.
- **Link** — UDP (`udpin` / `udpout`), recent URLs, SITL vs live-board badge, force disarm in air.
- **Loop** — TECS and L1 internals with wiki copy. Clicking a map card stays on Map.

### Install (Windows)

Download the NSIS setup or the MSI. Open **SITL**, pick a thumb, **Start** — or Link an existing vehicle.

### From source

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 (needs Node.js and Rust). Installer: `npm run build`.

### Not in this release

- QuadPlane, autoland flare
- Full harmonic-notch wizard (harmonics, HNTC2, MODE)
- Conventional ArduPilot tuning workflow (Mission Planner / log protocol)
