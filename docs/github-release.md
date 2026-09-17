# GitHub release — ArduLoops 0.4.0

Paste this as the release body. Tag: `0.4.0`. Title: `ArduLoops 0.4.0`.

Attach (after `npm run build`):

- `ArduLoops_0.4.0_x64-setup.exe`
- `ArduLoops_0.4.0_x64_en-US.msi`

from `src-tauri/target/release/bundle/nsis/` and `…/bundle/msi/`.

---

**ArduLoops 0.4.0** — click a layer on the map, and read the target as yellow.

We want an angle. We do not command the angle — we command the rate that takes us there.

### What's in 0.4.0

- **Layers** — the Cascade tab is now Layers. Click PosControl or Attitude (the band, not only a node) to inspect that layer.
- **Plot** — FC target is yellow (was white). Error is a gap wash, not a fifth trace. Legend: stick / target / actual / error gap.
- **SITL** — SITL and Reset sit in a dock left of the title. Reset shows when the rail is open.

### Install (Windows)

Download the NSIS setup or the MSI, then **Link** SITL at `tcpout:127.0.0.1:5763`.

### From source

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 (needs Node.js and Rust). Desktop: `npm run desktop`.

### Not in this release

- Plane layers (RLL_ / PTCH_ / L1 / TECS) — stub only
- Full harmonic-notch wizard (harmonics, HNTC2, MODE)
- Conventional ArduPilot tuning workflow (Mission Planner / log protocol)
