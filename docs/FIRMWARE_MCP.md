# Custom firmware through MCP

ArduLoops exposes three firmware tools alongside vehicle diagnostics:

- `ardupilot_firmware_catalog`: `vehicles`, `versions`, `boards`, `features`, `standard_artifacts`.
- `ardupilot_firmware_build`: `plan`, `submit`, `status`, `logs`, `download`.
- `ardupilot_firmware_flash`: `ports`, `prepare`, `start_bootloader`, `status`.
- `ardupilot_firmware_library`: local images and compatibility with the currently connected board.

The catalog and build tools use the official [Custom Firmware API](https://custom.ardupilot.org/api/docs).
Only vehicle family, board, version and feature IDs are sent to that service. Local parameters and telemetry stay local.

## Requirements

The firmware tools are implemented in the ArduLoops Rust binary. USB operations use the native serial transport and the ArduPilot serial-bootloader protocol; Python, `pyserial`, and an ArduPilot source checkout are not required.

Data is saved under `%LOCALAPPDATA%/ArduLoops/firmware` (Linux fallback: `~/.local/share/ArduLoops/firmware`).
Override this with `ARDULOOPS_FIRMWARE_DIR`. Keep that directory private: it contains parameter backups.
After building/restarting the MCP server, reconnect the MCP client so it refreshes the tool list.

The cross-platform SQLite catalog uses the platform-owned app-data directory (for example,
`%LOCALAPPDATA%/ArduLoops/catalog.sqlite3` on Windows and the application data directory on Android).
The headless bridge falls back to the standard Linux user-data directory. It stores only local firmware metadata, checksums, paths,
feature sets and controller identity/last-seen records. Parameter values and diagnostic telemetry remain outside it.
Existing downloaded artifacts are imported from the local firmware directory on first access. The web **прошивки** tab
uses this catalog and highlights images matching the live vehicle type and ArduPilot board ID.

SQLite itself is portable across Windows, Linux, macOS and Android. ArduLoops currently ships and is validated as a desktop app;
an Android application target and USB transport still need separate mobile implementation.

## Build workflow

1. Select exact IDs from the catalog, including the board-specific feature list.
2. Call `plan` with `vehicle_id`, `version_id`, `board_id`, `enable` and `disable` arrays.
   It preserves the board/version defaults, applies the requested changes and adds dependencies recursively.
   Unknown features and disabled dependencies cause errors. The returned `added`/`removed` lists make the change reviewable.
3. Call `submit` with its `plan_id`. The selected feature list is a complete configuration, not a patch.
4. Use `status`/`logs` with the returned `build_id`. If the board's flash is too small, inspect the build failure;
   the tool never silently removes other features to make it fit.
5. After success, call `download`. It verifies the remote board/version/features, safely reads the archive,
   validates the APJ and records its SHA256. Only builds submitted by this local installation are accepted for download.

Submission is recorded before the POST. A network failure may mean the server accepted the job;
the same plan is not automatically submitted twice. Resolve uncertainty using the service before creating another plan.
An already confirmed submission returns the same build ID on repeated calls.

Example plan for JHEM_JHEF405, Copter 4.7.1, adding FlowHold:

```json
{
  "action": "plan",
  "vehicle_id": "copter",
  "version_id": "ardupilot-dbe792162d06cab66c3475fd5556bf7a120f119e-c9945561",
  "board_id": "JHEM_JHEF405",
  "enable": ["MODE_FLOWHOLD"],
  "disable": []
}
```

Query the catalog again when choosing another release; version IDs are service-specific.

## USB flashing workflow

This implementation uses a native Rust client for the **ArduPilot serial bootloader** protocol.
It does not support DFU, UDP flashing, external-flash images, anonymous USB devices or automatic COM-port changes.
A BOOT button on many boards enters STM32 DFU; that is a different protocol.

1. Connect telemetry by UDP and connect the target board by USB. Release that USB serial port in all other applications.
   Remove propellers, disarm and obtain a fresh heartbeat, firmware identity and complete parameter download.
2. Use `ports`, then `prepare` with a downloaded `artifact_id` and the exact USB `port`.
   This checks the live board/vehicle type and saves JSON plus `.param` backups and diagnostics.
   It returns the image hash, USB identity, backup path and a ten-minute plan.
3. Review the actual image and device with the user. Only after authorization, call `start_bootloader` with `plan_id`
   and the exact `confirmation` string returned by `prepare`. It starts the uploader and then sends MAVLink
   `MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN` with action `3` to enter bootloader. It requires a fresh, disarmed heartbeat,
   and rechecks live state, device identity, image and uploader hashes. Plans are single-use; concurrent uploads are blocked.
4. The worker probes that chosen USB device for 60 seconds. The serial number and USB vendor must remain the same;
   the product ID may change in bootloader. A changed COM port or identity causes failure before writing.
5. The worker checks the bootloader board ID and available flash before erasing, then performs
   erase, programming and protocol-level verification without `force`. Check `status` for progress and the log tail.

The worker persists beyond an MCP client disconnect. It is not killed on a programming timeout and it never retries
an erase/write automatically. `written_verified` means the uploader verified the write; it does not establish flight readiness.
Reconnect and check firmware identity, parameters, sensor health, modes and normal pre-arm checks before any flight.
Parameter backups are not restored automatically across versions.

After a process/OS crash, `flash.lock` can remain and status may reflect the last recorded phase.
Do not assume the flash finished. Inspect the log and confirm no worker is running before manually clearing that lock
and preparing recovery. The tool cannot roll back an interrupted write.

## Validation

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
```

Tests cover feature dependency resolution, bounded APJ decoding, archive traversal/ambiguity, submission uncertainty,
stale/armed/wrong-board preflight rejection, image tampering and mocked uploader behavior before/after programming failures.
Hardware flashing must be validated separately on the selected board; automated tests never erase a device.
