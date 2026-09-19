# Scope inventory — what to watch per card

Live traces only. Gains (`ATC_RAT_RLL_P`, `RLL_RATE_FF`, …) stay on the sliders. If the wiki and this stand disagree, the wiki wins.

Sources on the wire today: `ATTITUDE`, `ATTITUDE_TARGET` (copter), `NAV_CONTROLLER_OUTPUT` (plane angle + alt error), `PID_TUNING` (desired/achieved rate), `GLOBAL_POSITION_INT` (AGL, climb), `VFR_HUD` (airspeed, heading, throttle), RC stick.

Not on this sample (do not invent): NE position/velocity, vertical accel demand, lateral accel `ay`, servo PWM (`AETR.*`), TECS demanded airspeed.

---

## Copter

Wiki: [Tuning Process](https://ardupilot.org/copter/docs/tuning-process-instructions.html) · rate tune checks `RATE.RDes` vs `RATE.R` (live: `PID_TUNING`) · angle checks `ATT.DesR` vs `ATT.Roll` (live: `ATTITUDE_TARGET` vs `ATTITUDE`).

| Card | Wiki watch | Live fields | Panes | Gap |
| --- | --- | --- | --- | --- |
| Pilot stick | Stick is the request (angle / climb / rate by mode). Input shaping is feel. | RC vs demand vs attitude; height: throttle + climb | angle (or climb) | demand ↔ actual |
| Navigation | Path speeds, not a PID. | No N/E on the sample. `VFR_HUD.groundspeed` + AGL | speed · height | — |
| NE position | `PSC_NE_POS` P. Leave until ATC is done. | No N/E. Downstream lean is roll/pitch | lean (output) | — |
| D position | Height P. AGL error → climb. | `alt_tar` (from `alt_error`) vs `alt` | height | target ↔ AGL |
| NE velocity | Loiter weave after ATC. Speed → lean. | No N/E vel. Lean output = roll/pitch | lean (output) | — |
| D velocity | Climb command → accel. | `climb_des` vs `climb` | climb | tar ↔ act |
| lean angle | Geometry, `ATC_ANGLE_MAX`. | Achieved bank/pitch | lean | — |
| D acceleration | Throttle from vertical accel. **Accel demand not on MAVLink.** | Climb is the plant we can see | climb (proxy) | tar ↔ act |
| angle → rate | `ATT.Des*` vs `ATT.*`. Do not hide a weak rate with ANG P. | stick, `ATTITUDE_TARGET`, `ATTITUDE` | angle | target ↔ actual |
| rate → torque | `RATE.*Des` vs `RATE.*`. Tune in Stabilize. | `PID_TUNING.desired` / `.achieved` | rate | desired ↔ gyro |
| Motors | Hover near mid stick (`MOT_THST_HOVER`). | RC throttle vs `VFR_HUD.throttle` | throttle | — |

Axis buttons remap the same card: roll / pitch / yaw / height keys.

---

## Plane

Wiki: [Tuning Quickstart](https://ardupilot.org/plane/docs/tuning-quickstart.html) · [Roll/Pitch/Yaw](https://ardupilot.org/plane/docs/new-roll-and-pitch-tuning.html) · [TECS](https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html) · [L1](https://ardupilot.org/plane/docs/navigation-tuning.html) · [Ground steering](https://ardupilot.org/plane/docs/tuning-ground-steering-for-a-plane.html).

| Card | Wiki watch | Live fields | Panes | Gap |
| --- | --- | --- | --- | --- |
| Pilot stick | FBWA stick is an angle. MP: pitch vs `nav_pitch`. | RC, `nav_roll`/`nav_pitch`, `ATTITUDE` | angle | demand ↔ actual |
| Navigation | Track + altitude to hold. | AGL target vs AGL | height | target ↔ AGL |
| L1 track | Observe turns (period). Live analogue: demanded bank vs actual. | `nav_roll` vs `ATTITUDE.roll` | bank | demand ↔ roll |
| TECS energy | Height hold in loiter; airspeed in climb; `nav_pitch` if it oscillates. No TECS airspeed setpoint on this sample. | AGL, `nav_pitch` vs pitch, `VFR_HUD` airspeed + throttle | height · pitch · speed/thr | height, pitch |
| Roll angle | MP: `pitch`/`nav_pitch` (same idea for roll). TCONST. | RC, `nav_roll`, `ATTITUDE.roll` | angle | demand ↔ roll |
| Pitch angle | Same, pitch axis. `PTCH2SRV_RLL` is a turn check, not this plot. | RC, `nav_pitch`, `ATTITUDE.pitch` | angle | demand ↔ pitch |
| Roll rate | FF first: desired rate vs achieved (`PID_TUNING`). Log method also uses `PIDR.Act` × SS vs `AETR.Ail` — **PWM not on this sample.** | `PID_TUNING` roll | rate | desired ↔ gyro |
| Pitch rate | Same for pitch. | `PID_TUNING` pitch | rate | desired ↔ gyro |
| Yaw damper | Wag = too much DAMP. Sideslip uses `ay` — **not on this sample.** | `ATTITUDE.yawspeed`; bank (RLL mix) | yaw rate · bank | — |
| AHRS | Measured bank the damper reads. | `ATTITUDE.roll` / `.pitch` | attitude | — |
| Ground steer | Runway heading, below `GROUND_STEER_ALT`. | `VFR_HUD.heading` vs `ATTITUDE.yaw` | heading | — |
| Throttle | TECS writes it in AUTO/FBWB; stick in FBWA. | RC throttle vs `VFR_HUD.throttle` | throttle | — |
| Aileron | Plant is airspeed² around `SCALING_SPEED`. Rate loop writes the surface. | rate + airspeed on the readout | rate | desired ↔ gyro |
| Elevator | Same, pitch rate. | pitch rate + airspeed | rate | desired ↔ gyro |
| Rudder | Damper writes it. | yaw rate | yaw rate | — |
| Nose | Same loop as ground steer. | heading | heading | — |

Airspeed is a readout on inner-loop panes (the plant scaler), not a third trace on the rate plot.

---

## Fallback

No card selected: traces follow the default rate loop so the plot is never blank.
