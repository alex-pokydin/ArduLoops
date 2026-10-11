# Firmware

**Controller → firmware** is the `.apj` images stored on this computer. **Compatible** keeps the ones that match the board on the link. **All local** shows the rest. **Add firmware** imports a file from this computer, up to 16 MB. A comment on an image, and the comment on the controller card, stay on this computer.

## Flash

Propellers off. Leave the vehicle on its telemetry link, and leave the board’s USB port free. No other program should be holding that port.

1. Pick an image and a USB port.
2. **Prepare** checks the live board, saves a parameter backup and the diagnostics, and returns a confirmation phrase. The plan lasts about ten minutes.
3. Read the image, the port, and the backup. Type that phrase and start. The app asks the vehicle to reboot into the ArduPilot serial bootloader, then erases, writes, and checks the write.
4. **Status** is the phase. A verified write means the uploader checked the image. It does not mean the vehicle is ready to fly. Reconnect and check the firmware, the parameters, the sensors, the modes, and prearm.

This path is the ArduPilot serial bootloader. A BOOT button that enters STM32 DFU is a different protocol, and this page does not use it. An interrupted write is not rolled back. A parameter backup is not restored on its own when the version changes.

Building a custom image — the catalog, the feature list, submit, and download — is the firmware tools described in [CLI and Cursor](cli.md). The call-by-call protocol is [FIRMWARE_MCP.md](FIRMWARE_MCP.md). A finished download shows up in this library.
