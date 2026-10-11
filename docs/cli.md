# CLI and Cursor

Start ArduLoops first, with `npm run dev` or the desktop app. The window and these clients share one MAVLink link, on `http://127.0.0.1:8767`. They do not open a second SITL port.

If the app is not on that address, set `ARDULOOPS_HTTP`.

## CLI

```bash
npm run cli -- state
npm run cli -- statustext
npm run cli -- diagnostics
npm run cli -- param get ATC_RAT_RLL_P
npm run cli -- param set ATC_RAT_RLL_P 0.1
npm run cli -- param list ATC_RAT_*
npm run cli -- mode STABILIZE
npm run cli -- arm
npm run cli -- disarm
npm run cli -- reboot
npm run cli -- connect tcpout:127.0.0.1:5770
npm run cli -- disconnect
npm run cli -- health
```

`param set`, `mode`, `arm`, `reboot`, and `connect` are the same writes as the window. They go to the vehicle. `diagnostics refresh` asks the vehicle again before the read.

## Cursor

**Options → MCP → Copy** fills in the path of the app you are running. The shape is:

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

The running app is the link. `--mcp` is how Cursor attaches to it. The firmware catalog, build, and flash tools on that server are described in [FIRMWARE_MCP.md](FIRMWARE_MCP.md).
