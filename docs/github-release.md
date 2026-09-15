# GitHub release — ArduLoops 0.2.0

Paste this as the release body. Tag: `0.2.0`. Title: `ArduLoops 0.2.0`.

Suggested repository description: `Live stand for reading ArduPilot copter loops — plot, cascade, and PID diagram on a MAVLink link.`

Attach (after `npm run build`):

- `ArduLoops_0.2.0_x64-setup.exe`
- `ArduLoops_0.2.0_x64_en-US.msi`

from `src-tauri/target/release/bundle/nsis/` and `…/bundle/msi/`.

---

**ArduLoops 0.2.0** — the cascade teaches first-flight knobs, and Loop extend shows the rest of the closed regulator.

We want an angle. We do not command the angle — we command the rate that takes us there.

### What's in 0.2.0

- **Cascade** — short why / typical-mistake inspect; Stabilize tune vs Loiter-later highlighting; live hover, stick climb, lean ceiling, WP / Loiter speeds
- **Loop · extend** — AC_PID internals on the diagram: FLTT / FLTE / FLTD, IMAX, SMAX, FF · r
- **Gyro notch** — `INS_HNTCH` on the cyan feedback path (IMU, not inside the PID). FREQ is from hover FFT, not a feel slider
- Init writes the stand **without reboot** (live `FRAME_CLASS`) so Mission Planner SITL stays up
- Height axis labeled as height; stand `.parm` dumps in the repo

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
