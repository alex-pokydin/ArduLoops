# ArduLoops

A live stand for **reading ArduPilot copter loops**. Link a SITL (or any MAVLink) vehicle, then watch target vs actual, which loops the current mode closes, and how a PID loop is wired.

We want an angle. We do not command the angle — we command the rate that takes us there.

## Views

### Plot

Angle we want (°) and rate we command (°/s). Legend maps colour to **stick / target / actual**. Pause with the button or Space.

![Plot: angle we want and rate we command](docs/plot.png)

### Cascade

Stock Copter map: PosControl (outer) holds *where to be*, Attitude Control (inner) holds the angle. Inactive blocks in the current mode are dimmed. Click a block to inspect gains.

![Cascade: Copter loop map](docs/cascade.png)

### Loop

Closed regulator: setpoint → error → P/I/D → plant → actual, with feedback. Same P/I/D as the selected block on the map.

![Loop: closed PID diagram](docs/loop.png)

## Requirements

- [Node.js](https://nodejs.org/) (for the UI)
- [Rust](https://rustup.rs/) (MAVLink; browser and desktop)
- An ArduPilot vehicle on MAVLink — typically [SITL](https://ardupilot.org/dev/docs/sitl-simulator-software-in-the-loop.html) on `tcpout:127.0.0.1:5763`

## Run in the browser

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite is the page; a headless Rust process owns MAVLink and HTTP `127.0.0.1:8767`. No installer, no Tauri window.

Paste a connection string and click **Link**:

| URL | Typical use |
| --- | --- |
| `tcpout:127.0.0.1:5763` | SITL default (ArduLoops connects out) |
| `tcpout:127.0.0.1:5762` | SITL second GCS — use if 5763 is already taken |
| `tcp:host:port` | TCP inbound |
| `udpin:0.0.0.0:14550` | UDP listen (GCS-style) |

Each SITL TCP port accepts **one** GCS. Do not run `npm run dev` and the desktop app against the same port at once — the second instance will try `5762`.

Raise throttle in Stabilize if the craft is sitting on the ground — otherwise the stick barely moves attitude.

## Desktop

```bash
npm run desktop    # Tauri window, same UI
npm run build      # Windows installers
```

`npm run build` writes:

- `src-tauri/target/release/bundle/nsis/ArduLoops_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/ArduLoops_0.1.0_x64_en-US.msi`

## Options

Gear in the header.

- **Language** — English (default) or Ukrainian. The choice is kept in the browser.
- **Init** (when linked, disarmed) — apply the SITL stand (Quad X + dummy IMU on copter; dummy IMU on plane) and reboot the autopilot. The link drops briefly.
- **Export** — write live parameters to a `.parm` file.
- **MCP** — copy a Cursor config. The running app already serves HTTP `127.0.0.1:8767`. Cursor launches `arduloops.exe --mcp`; that process is not a second MAVLink link.

## MCP

Start ArduLoops first (`npm run dev` or the desktop exe), then add this to Cursor `mcp.json` (Options → MCP → Copy fills in the real path):

```json
{
  "mcpServers": {
    "arduloops": {
      "command": "C:\\Program Files\\ArduLoops\\arduloops.exe",
      "args": ["--mcp"]
    }
  }
}
```

## CLI

Same MAVLink as the UI, via HTTP `127.0.0.1:8767` of the running app.

```bash
npm run cli -- state
npm run cli -- param get ATC_RAT_RLL_P
npm run cli -- mode STABILIZE
```

## Notes

- Built for **Copter**. The Plane cascade (RLL_ / PTCH_ / L1 / TECS) is still a stub.
- Presets **Wool / Stock / Sharp** illustrate feel on the stand. They are not a tuning protocol.
- Do not bump `mavlink` in `src-tauri/Cargo.toml` (stay on **0.13.1**).
