# Parameters

**Controller → parameters** is the set on the vehicle now. After you link, the app reads the full list in the background. A change made later is stored as it arrives.

You can filter by name, or by the short description stored for that name. The groups are Flight control, Navigation, Sensors, Radio, Power, Outputs, Safety, System, and Other. Edit a value and write it. The write shows up in [Audit](audit.md).

**Back up** writes a `.parm` file once every parameter has arrived. **Restore** writes a file back only on a fresh disarmed link, and only after the live list is complete. The confirm tells you how many values will be written. Names this vehicle does not have, failures, and refusals are counted in the result. **Options → Export** is the same live `.parm`.

The card above the tabs is this board: its identity, and a comment that stays on this computer. The comment is the place for a fact that is not a parameter, such as the span, the mass, or the propeller. The assistant can store a fact you state there. A measurement from one flight does not belong in that note.

**Wool**, **Stock**, and **Sharp** live on the [loops](loops.md) stand. They set a feel on the rate loop. They are not this list.
