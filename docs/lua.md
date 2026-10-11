# Lua

**Lua** reads the scripts stored on the vehicle, edits one, and sends it back.

Connect first. If this firmware was built without scripting, the page says so. If `SCR_ENABLE` is off, **Enable scripting** writes 1. Restart the vehicle after that. The engine starts at boot, and the file list loads when the link is back.

Create a file whose name ends in `.lua`, edit it, and save. After a save, reload scripting so the vehicle runs that file. **Reload** restarts the engine without a full reboot. Delete removes the file on the vehicle.

The [assistant](assistant.md) can list these files, read one, and quote a line. The quoted lines are marked in the editor, so “what does this line do?” has a line to point at.
