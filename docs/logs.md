# Logs

**Controller → Logs** lists the DataFlash files on the vehicle, with the firmware, the frame, and how long each one ran. **Download** copies one to this computer. The [assistant](assistant.md) can then measure that file: how far actual sat from the command, whether a command held, and a spectrum of the columns in the file. The measurement describes the file. It is not a tuning recipe.

**This controller** is the board on the link. **All controllers** is every board this app has saved a log for. A file is local only after the download finishes. If a local copy of that onboard log already has the same size, a later download can reuse it.

**Erase** clears the logs on the vehicle and waits until the vehicle says the erase finished. Parameters are left alone.

## Telemetry log

**Options → Telemetry log** records the live MAVLink stream as a Mission Planner `.tlog` while the link is up. You pick the folder. This is a recording of the link. The assistant does not treat it as a DataFlash file.
