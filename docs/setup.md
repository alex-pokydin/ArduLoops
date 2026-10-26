# Setup

**Controller → Setup** is the walk-through before the first flight. The steps follow the frame the heartbeat reported. The assistant can open the wizard that matches the vehicle on the link. See [Assistant](assistant.md) for a session that opened flight modes, read the six positions, and changed the switch channel from a card.

## Copter

1. **Frame.** Pick the picture that matches the frame and save it. The frame class is applied while the vehicle is disarmed.
2. **Motor numbering.** Propellers off. Spin an output and tap the arm that moved. That output becomes that motor, and the outputs are saved together. Then spin each motor and compare it with the arrow. A DShot ESC is reversed in software; a PWM ESC needs two motor wires swapped. Idle throttle and the ESC settings are behind the settings button. The drawing follows the frame on the vehicle: any ArduPilot matrix frame, or Tri.
3. **Radio.** Watch every channel, save the stick ends, and reverse a stick that moves the wrong way. The receiver port is left as it is.
4. **Level and sensors.** Propellers off. Pick a sensor, match the picture, and start.
5. **Compass.** The offsets on screen are the last calibration. Start runs a new one: turn the vehicle until every compass fills.
6. **Flight modes.** Find the switch channel, then give each position a mode you can fly.
7. **Failsafe.** Choose what the vehicle does when the radio or the battery is lost.
8. **Battery.** Set the sensor and the capacity, then match the voltage and zero the current if you want to. What happens when the battery is low stays on the failsafe step.
9. **Servos.** Output channel settings. The motor names belong to the motor step.

## Plane

1. **Servo outputs.** Name the four surfaces, and reverse one that moves the wrong way. ESC calibration stays in the wiki, with the propeller removed.
2. **Radio, level, compass, and flight modes.** The same steps as on a copter.
3. **Failsafe.** Radio or battery. The EKF threshold stays in the wiki.
4. **Airspeed.** If there is no airspeed sensor, say so here. The usual default expects a sensor that may not be fitted.
5. **Battery.** The same step as on a copter.

Copter: [First Time Setup](https://ardupilot.org/copter/docs/initial-setup.html). Plane: [First Time Setup](https://ardupilot.org/plane/docs/first-time-setup.html).

**Options → Init**, while the link is up and the vehicle is disarmed, writes the lab stand dump so a blank board can arm. That dump is for the stand. It is the wrong file to take outdoors.
