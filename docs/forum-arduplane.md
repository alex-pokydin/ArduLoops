# Forum draft — ArduPilot Discourse

Paste into a new topic. Suggested category: [ArduPlane](https://discuss.ardupilot.org/c/arduplane). Moderators may move it to [Other GCS](https://discuss.ardupilot.org/c/ground-control-software/other-gcs/74) — either is fine.

**Title:** Asking the community for help, especially experienced plane people — ArduLoops live map of L1 and TECS

---

Hi all,

I am asking the community for help, especially from people who actually fly and tune planes.

I built a small live stand for *seeing* ArduPilot loops — which blocks the current mode closes, and which knobs sit on them. It started as a copter tool. I recently drew a Plane **map**, with **L1** and **TECS** as the outer path (not copter PosControl). I am not a plane person. The wiki is the protocol: if this picture disagrees with the wiki, the wiki wins. I would like you to look at the map and the two outer schemes and tell me where they are wrong, incomplete, or the convenient lie.

It is **not** Mission Planner, not Autotune, and not a tuning protocol. Live MAVLink only. HEARTBEAT mounts copter or plane.

- Source: https://github.com/alex-pokydin/ArduLoops
- Installers (1.1.0): https://github.com/alex-pokydin/ArduLoops/releases/tag/1.1.0

## The map — this is the thing I need eyes on

One picture of the live path. Top is command (stick + mission targets). Then a **Navigate** band: L1 and TECS sit **outside** attitude, side by side. Then roll and pitch as two cards, yaw damper, ground steer, then surfaces.

Empty map = this mode’s path (dimmed cards are not closed now). Click a card = only that block’s in and out. Left edge: solid = tune these, hollow double = later, dashed = no knobs.

![Plane map: L1 and TECS outside attitude](https://raw.githubusercontent.com/alex-pokydin/ArduLoops/master/docs/plane-map.png)

What I am trying to say with that layout:

- There is **no** `PSC_*` stack on a wing. Horizontal path is L1 (cross-track → demanded bank). Height/speed is TECS (energy → pitch + throttle). They are not one “outer PID”.
- L1 writes `nav_roll` into the **roll** loop. TECS writes `nav_pitch` and throttle. In FBWA the stick is the angle and the left stick is still throttle — L1/TECS should go dim. In AUTO / LOITER / RTL they should light up (TECS also in FBWB / CRUISE).
- I may have the live-in-mode list wrong (TAKEOFF, GUIDED, TRAINING, CRUISE vs FBWB). That dimming is the part I trust least.

If the map’s *shape* is wrong — wrong neighbours, wrong “outside”, a missing first-flight block — that is the most useful reply I can get.

## L1 — what the Loop tab draws when you click that card

Wiki I used: [L1 navigation](https://ardupilot.org/plane/docs/navigation-tuning.html).

The scheme is: look a distance L1 ahead of the track → lateral acceleration → bank φ\* = atan(a/g) → `nav_roll` for the roll loop.

- L1 = (1/π) · DAMPING · PERIOD · groundspeed (so the same PERIOD feels the same at different speeds)
- K = 4 · DAMPING²
- a = K · V² / L1 · sin(Nu) — Nu and a_y are **not** on this MAVLink sample; we show `nav_roll`
- `NAVL1_PERIOD` is the main knob (wiki start ~17, damping 0.75). Smaller = tighter turn. Weaving after a turn: add 1–2 s. Turn too slow: subtract about 5.
- Tune roll first. Raising PERIOD will not hold a wing that cannot hold bank. `ROLL_LIMIT_DEG` is the stall-safe bank, not an L1 gain. `WP_RADIUS` is fly-through vs turn-early.

Does that match how you explain L1 to a new pilot? Is PERIOD really the knob to touch, or am I hiding `NAVL1_DAMPING` / `WP_RADIUS` in the wrong place?

## TECS — same idea, the other Navigate card

Wiki I used: [TECS speed/height](https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html).

I tried not to draw a black box. The scheme is one energy, two plants:

- SPE = g · h (potential, per unit mass)
- SKE = ½ V² (kinetic)
- **STE** = SPE + SKE → **throttle** (total energy)
- **SEB** = (2−W)·SPE − W·SKE → **pitch** (energy balance: nose down trades height for speed)
- **W** = `TECS_SPDWEIGHT`: 0 pitch holds height, 2 pitch holds speed (glider), 1 mix. It is **not** a P. A circle sits where the four arrows cross.

![TECS energy scheme](https://raw.githubusercontent.com/alex-pokydin/ArduLoops/master/docs/plane-loop.png)

Also on the picture: height error and airspeed feed SPE/SKE; throttle and pitch limits (`THR_MAX`, `TRIM_THROTTLE`, `PTCH_LIM_*`, climb/sink) sit at the edges. Click a block for extra knobs under the scheme; the sidebar keeps the main ones.

Stories I need checked:

- Throttle cannot set the balance — that is pitch. Pitch cannot set the total — that is throttle.
- Without an airspeed estimate, W is forced to 0.
- Measure `TECS_CLMB_MAX` / `SINK_MIN` / `SINK_MAX` in FBWA; if they are optimistic, height oscillates.
- Porpoise → pitch **rate** first, then `TECS_TIME_CONST`. Do not hunt a height P.
- In FBWA the left stick is still throttle. TECS should not look “live” there.

If SPE/SKE/STE/SEB/W is not how you think about TECS, or the arrows are swapped, please say so in those letters.

Inner loops (rate FF in FBWA, yaw damper, ground steer) are on the same map below L1/TECS. Happy to hear if those cards are wrong too — but the ask is the **Navigate** band.

## How to try it

Windows or Linux x86_64 from [release 1.1.0](https://github.com/alex-pokydin/ArduLoops/releases/tag/1.1.0). **SITL** in the header → plane thumb → **Start**. It downloads official SITL and Links `tcpout:127.0.0.1:5770`.

![SITL rail](https://raw.githubusercontent.com/alex-pokydin/ArduLoops/master/docs/sitl.png)

Then:

1. Leave it in **FBWA**. Empty map: L1/TECS dim, roll/pitch live. Does that match the aircraft?
2. Switch **AUTO** (or FBWB / CRUISE). Do L1 and TECS light the way you expect?
3. Click **L1**, open **Loop**. Then **TECS**. Walk the blocks. If a box or an arrow is the lie, name it.

A real board is the same **Link** (close Mission Planner — one TCP client per SITL port). From source: `npm install && npm run dev` → http://127.0.0.1:5173.

Five minutes on the map + those two schemes, and a reply like “TECS card is wrong because…” or “L1 should not sit next to …” helps more than “looks cool”.
