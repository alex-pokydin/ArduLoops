# GitHub release — ArduLoops 0.1.0

Paste this as the release body. Tag: `v0.1.0`. Title: `ArduLoops 0.1.0`.

Suggested repository description: `Live stand for reading ArduPilot copter loops — plot, cascade, and PID diagram on a MAVLink link.`

Attach:

- `ArduLoops_0.1.0_x64-setup.exe`
- `ArduLoops_0.1.0_x64_en-US.msi`

from `src-tauri/target/release/bundle/nsis/` and `…/bundle/msi/`.

---

First public release of **ArduLoops** — a live stand for reading ArduPilot copter loops.

We want an angle. We do not command the angle — we command the rate that takes us there.

### What's in 0.1.0

- **Plot** — angle we want (°) vs rate we command (°/s); stick / target / actual
- **Cascade** — stock Copter map (PosControl outer, Attitude Control inner); inactive loops dimmed by mode
- **Loop** — closed PID diagram for the selected block
- Live **MAVLink** (`tcpout`, `tcp`, `udpin`)
- Virtual sticks, flight mode, arm/disarm
- Wool / Stock / Sharp rate-PID presets (illustration, not a wiki protocol)
- Ukrainian / English
- Options: SITL Init (when linked), `.parm` export, and Cursor MCP (`arduloops.exe --mcp` against the running app)

### Install (Windows)

Download the NSIS setup or the MSI, then **Link** SITL at `tcpout:127.0.0.1:5763`.

### From source

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 (needs Node.js and Rust). Desktop: `npm run desktop`.

### Not in this release

- Plane cascade (RLL_ / PTCH_ / L1 / TECS) — stub only
- Conventional ArduPilot tuning workflow (Mission Planner / log protocol)
