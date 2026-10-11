# Missions

**Mission** draws a route on the live position and uploads it to the vehicle.

Click the map to add a waypoint. Set the altitude in metres: 2 to 120 on a copter, 2 to 400 on a plane. **End with RTL** finishes at home. Clear it and the route ends in a loiter. **Loiter here**, **North leg**, and **Square** drop a preset around where you are. **Upload mission** writes the plan. **AUTO** starts it. **RTL** sends the vehicle home. **Erase mission** clears the plan on the vehicle.

The map marks the board, the GPS fix, the true position when the simulator has one, and home. **Fit map** frames whatever of those you have. Until a position arrives, the map says so.

On a plane, **Show L1 track** draws the look-ahead: the L1 circle, Nu, and the cross-track error. The picture uses `NAVL1_PERIOD`, `NAVL1_DAMPING`, `WP_RADIUS`, and cruise speed.
