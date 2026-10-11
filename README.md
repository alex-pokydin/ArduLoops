# ArduLoops

ArduLoops is a ground station for an ArduPilot copter or plane. You link a vehicle and watch which loops the current mode is actually closing. The same window is where you set the vehicle up, read a DataFlash log, draw a mission, and edit Lua on the board.

Until a heartbeat arrives, you get the start page. After the heartbeat, the shell matches the frame.

The assistant sits on the right. It reads this link, the parameters, and a log you have downloaded. A number in an answer is a number a tool returned. A change waits until you confirm it.

The start page itself is [`docs/start.md`](docs/start.md) (English) and [`docs/start.uk.md`](docs/start.uk.md). Home renders that markdown.

## Where to go next

- [Loops](docs/loops.md) — the map, the scheme for the card you picked, and the traces
- [SITL](docs/sitl.md) — start official firmware from the left rail
- [Setup](docs/setup.md) — frame, motors, radio, sensors, modes, failsafe
- [Parameters](docs/parameters.md) — the live set, a `.parm` file, lab Init
- [Logs](docs/logs.md) — DataFlash on the board, and a live `.tlog`
- [Missions](docs/missions.md) — draw a route and upload it
- [Lua](docs/lua.md) — scripts stored on the vehicle
- [Firmware](docs/firmware.md) — local images, and flashing one over USB
- [Audit](docs/audit.md) — what this app wrote
- [Assistant](docs/assistant.md) — questions against this link, with real sessions
- [CLI and Cursor](docs/cli.md) — the same MAVLink from the terminal or from MCP

QuadPlane, an autoland flare, a full harmonic-notch wizard, and Autotune as a procedure are outside this app. When the wiki and the stand disagree, follow the wiki.

## Run

You need [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/).

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). `dev` starts the page and the MAVLink process on `127.0.0.1:8767`. `?frame=plane` or `?frame=copter` opens that shell before anything is linked.

`npm run build` makes an installer for the OS you are on. GitHub Actions builds Windows, Linux, and macOS, and packs the macOS SITL binaries into the app. The Android build is a link client only. Leave `mavlink` in `src-tauri/Cargo.toml` on **0.13.1**.

Pick **TCP**, **UDP**, or **SER** in the header, fill the field, and click **Link**. You type the address, not a `tcpout:` or `udpin:` URL. The app adds that prefix itself.

| Kind | Field | When |
| --- | --- | --- |
| TCP | `127.0.0.1:5770` | SITL started from this app |
| TCP | `127.0.0.1:5760` | SITL you started with `--no-mavproxy` |
| TCP | `127.0.0.1:5763` | SITL behind MAVProxy |
| UDP | `14550` | Listen. The vehicle sends to this port |
| UDP | `192.168.6.167:14550` | Send to the vehicle |
| SER | `COM3` and `115200` | USB or a radio. Desktop only; Android has no serial |

A listen on 14550 also announces on 14555, and a send to port 14550 tries 14555 on that host as well. That is how an ESP8266 or SiK Wi-Fi bridge answers. A host and port 14550 or 14551 typed under TCP is opened as UDP.

A SITL TCP port accepts one ground station. If `npm run dev` is already on that port, the desktop app needs a different one. On this machine, a TCP port other than 5760 or 5770 is tried again on 5763 and 5762 when the first one stays quiet.

**Options** in the header is the language (English or Ukrainian), the plot window, lab **Init**, a parameter **Export**, the assistant account, a `.tlog`, and the Cursor MCP config.
