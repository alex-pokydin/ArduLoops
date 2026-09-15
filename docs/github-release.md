# GitHub release — ArduLoops 0.3.0

Paste this as the release body. Tag: `0.3.0`. Title: `ArduLoops 0.3.0`.

Attach (after `npm run build`):

- `ArduLoops_0.3.0_x64-setup.exe`
- `ArduLoops_0.3.0_x64_en-US.msi`

from `src-tauri/target/release/bundle/nsis/` and `…/bundle/msi/`.

---

**ArduLoops 0.3.0** — poke the SITL world from a left rail, and read P/I/D live on the Loop diagram.

We want an angle. We do not command the angle — we command the rate that takes us there.

### What's in 0.3.0

- **SITL rail** — button before the title; the header and the rest of the UI shift right. Accordion for wind, GPS, RC fail, motors, IMU, compass, baro, battery, sim speed (`SIM_*`). **Reset** restores the values from the start of the link. Hidden on a real board.
- **Loop** — live sparks on want / error / actual and on P, I, D, Σ. Pause next to extend. Legend is command / actual / error / PID. Extend extras are hot red; FF runs above P so it is not hidden.
- Init still writes the stand **without reboot** (live `FRAME_CLASS`) so Mission Planner SITL stays up

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
- Full harmonic-notch wizard (harmonics, HNTC2, MODE)
- Conventional ArduPilot tuning workflow (Mission Planner / log protocol)
