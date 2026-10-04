// Heartbeat, sticks, and reboot.


fn gcs_heartbeat() -> MavMessage {
    MavMessage::HEARTBEAT(HEARTBEAT_DATA {
        custom_mode: 0,
        mavtype: MavType::MAV_TYPE_GCS,
        autopilot: MavAutopilot::MAV_AUTOPILOT_INVALID,
        base_mode: MavModeFlag::empty(),
        system_status: mavlink::ardupilotmega::MavState::MAV_STATE_ACTIVE,
        mavlink_version: 3,
    })
}

fn stick_deg(st: &LinkState, pwm: i32) -> f64 {
    (pwm as f64 - 1500.0) / 500.0 * st.angle_max
}

fn axis_pwm(st: &LinkState, pitch: bool) -> i32 {
    let pulsing = st.pulse_until.map(|t| Instant::now() < t).unwrap_or(false);
    if !pitch && pulsing {
        return st.pulse_roll;
    }
    if st.virtual_stick {
        return if pitch { st.rc.pitch } else { st.rc.roll };
    }
    if pitch {
        st.rc_in_pitch
    } else {
        st.rc_in_roll
    }
}

fn yaw_pwm(st: &LinkState) -> i32 {
    if st.virtual_stick {
        st.rc.yaw
    } else {
        st.rc_in_yaw
    }
}

fn thr_pwm(st: &LinkState) -> i32 {
    let raw = if st.virtual_stick {
        st.rc.thr
    } else {
        st.rc_in_thr
    };
    if (801..2200).contains(&raw) {
        raw
    } else {
        1500
    }
}

fn thr_pct(pwm: i32) -> f64 {
    (pwm as f64 - 1500.0) / 5.0
}

fn param_ms(st: &LinkState, names: &[&str], fallback: f64) -> f64 {
    for name in names {
        if let Some(&v) = st.sample.params.get(*name) {
            // Older PILOT_SPEED_* were cm/s (~250). New PILOT_SPD_* are m/s (~2.5).
            return if v.abs() > 20.0 { v / 100.0 } else { v };
        }
    }
    fallback
}

/// AltHold / Loiter: throttle 0…1000 → climb m/s (up +). Matches Copter::get_pilot_desired_climb_rate_ms.
fn pilot_climb_ms(st: &LinkState) -> f64 {
    if !st.sample.armed {
        return 0.0;
    }
    let thr = (thr_pwm(st) as f64 - 1000.0).clamp(0.0, 1000.0);
    let mid = 500.0;
    let dz = st
        .sample
        .params
        .get("THR_DZ")
        .copied()
        .unwrap_or(100.0)
        .clamp(0.0, 400.0);
    let spd_up = param_ms(st, &["PILOT_SPD_UP", "PILOT_SPEED_UP"], 2.5).abs();
    let spd_dn = {
        let v = param_ms(st, &["PILOT_SPD_DN", "PILOT_SPEED_DN"], 0.0).abs();
        if v < 1e-6 {
            spd_up
        } else {
            v
        }
    };
    let top = mid + dz;
    let bot = (mid - dz).max(1.0);
    if thr < bot {
        spd_dn * (thr - bot) / bot
    } else if thr > top {
        spd_up * (thr - top) / (1000.0 - top).max(1.0)
    } else {
        0.0
    }
}

fn apply_d_targets(st: &mut LinkState) {
    if let (Some(alt), Some(err)) = (st.sample.alt, st.alt_error) {
        // NAV alt_error is D-error (target_D − pos_D). AGL = −D, so target AGL = AGL − error_D.
        st.sample.alt_tar = Some(alt - err);
    }
    st.sample.climb_des = Some(pilot_climb_ms(st));
}

fn override_channels(st: &LinkState, roll: i32, pitch: i32, thr: i32, yaw: i32) -> [u16; 8] {
    let mut ch = [0u16; 8];
    let put = |ch: &mut [u16; 8], axis: &str, pwm: i32| {
        if let Some(&n) = st.rcmap.get(axis) {
            if (1..=8).contains(&n) {
                ch[(n - 1) as usize] = pwm as u16;
            }
        }
    };
    put(&mut ch, "roll", roll);
    put(&mut ch, "pitch", pitch);
    put(&mut ch, "thr", thr);
    put(&mut ch, "yaw", yaw);
    ch
}

fn send_rc(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    let now = Instant::now();
    let pulsing = st.pulse_until.map(|t| now < t).unwrap_or(false);
    let hover = st.rc.thr > 0;
    if !st.virtual_stick && !hover && !pulsing {
        return;
    }
    let mut roll = 0;
    let mut pitch = 0;
    let mut yaw = 0;
    let mut thr = 0;
    if st.virtual_stick {
        roll = st.rc.roll;
        pitch = st.rc.pitch;
        yaw = st.rc.yaw;
        thr = if st.rc.thr > 0 { st.rc.thr } else { 0 };
    } else if hover {
        thr = st.rc.thr;
    }
    if pulsing {
        roll = st.pulse_roll;
    }
    if hover && thr <= 0 {
        thr = st.rc.thr;
    }
    let ch = override_channels(st, roll, pitch, thr, yaw);
    send_msg(
        conn,
        &MavMessage::RC_CHANNELS_OVERRIDE(RC_CHANNELS_OVERRIDE_DATA {
            chan1_raw: ch[0],
            chan2_raw: ch[1],
            chan3_raw: ch[2],
            chan4_raw: ch[3],
            chan5_raw: ch[4],
            chan6_raw: ch[5],
            chan7_raw: ch[6],
            chan8_raw: ch[7],
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn reboot_fc(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    // One COMMAND_LONG. Sending to 1 and 0 as well used to triple-boot
    // Mission Planner SITL (often with -w), which wiped FRAME_CLASS.
    command_long(
        conn,
        st.target_system,
        st.target_component,
        MavCmd::MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
        1.0,
        0.0,
    );
}

fn reboot_to_bootloader(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    // MAVLink REBOOT_SHUTDOWN_ACTION_REBOOT_TO_BOOTLOADER. This is the same
    // preflight command used by ground stations; never force it while armed.
    command_long(
        conn,
        st.target_system,
        st.target_component,
        MavCmd::MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
        3.0,
        0.0,
    );
}
