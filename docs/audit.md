# Audit

**Audit** is the local list of what this app wrote: a parameter, a connect or disconnect, a reboot, a mode change, arm, disarm, an erase of the onboard logs, and a firmware flash.

Each row has the action, the result, and who sent it. The result is applied, rejected, failed, or still waiting. A parameter row shows the value before and the value that was asked for. Several parameters written together stay as one group.

**Revert** on a parameter group offers the previous values back. A card names each change. Nothing is written until you confirm, and the vehicle has to be linked.

Search filters the list. **Refresh** reads it again. This list lives on this computer. It is not a DataFlash log. The [assistant](assistant.md) writes through the same cards, so a change it made is in this list too.
