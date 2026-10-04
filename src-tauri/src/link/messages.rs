// Command dispatch and incoming MAVLink.


fn apply_cmd(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    cmd: Cmd,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
) {
    match cmd {
        Cmd::Param { name, value } => set_param(conn, st, &name, value),
        Cmd::ParamsRestore { values, reply } => {
            let result = restore_params(conn, st, &values, |st| {
                emit_sample(on_sample, latest, st, sitl);
            });
            let _ = reply.send(result);
        }
        Cmd::ParamRead { name } => {
            send_msg(
                conn,
                &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
                    param_index: -1,
                    target_system: st.target_system,
                    target_component: st.target_component,
                    param_id: param_id(&name),
                }),
            );
        }
        Cmd::Calibrate { kind, reply } => {
            if !st.sample.ok || st.sample.armed || wall_time() - st.sample.heartbeat_at > 3.0 {
                let _ = reply.send("Calibration requires a fresh disarmed connection".into());
                return;
            }
            let (param1, param3, param5) = match kind.as_str() {
                "gyro" => (1.0, 0.0, 0.0),
                "level" => (0.0, 0.0, 2.0),
                "baro" => (0.0, 1.0, 0.0),
                "accel" => (0.0, 0.0, 4.0),
                _ => {
                    let _ = reply.send("Unsupported calibration".into());
                    return;
                }
            };
            let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
                command: MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION,
                target_system: st.target_system, target_component: st.target_component,
                confirmation: 0, param1, param2: 0.0, param3, param4: 0.0,
                param5, param6: 0.0, param7: 0.0,
            });
            if conn.send(&header(), &message).is_err() {
                let _ = reply.send("Could not send calibration command".into());
                return;
            }
            let deadline = Instant::now() + Duration::from_secs(35);
            let mut result = "Calibration timed out; check vehicle messages before retrying".to_string();
            while Instant::now() < deadline {
                match conn.recv() {
                    Ok((hdr, msg)) => {
                        let ack = if hdr.system_id == st.target_system && hdr.component_id == st.target_component {
                            if let MavMessage::COMMAND_ACK(v) = &msg {
                                (v.command == MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION).then_some(v.result as u8)
                            } else { None }
                        } else { None };
                        handle_msg(st, &hdr, msg);
                        emit_sample(on_sample, latest, st, sitl);
                        if let Some(code) = ack {
                            if code == 0 { result = "Calibration completed".into(); break; }
                            if code != 5 { result = "Calibration rejected or failed; check vehicle messages".into(); break; }
                        }
                    }
                    Err(mavlink::error::MessageReadError::Io(e)) if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => {},
                    Err(_) => { result = "Connection lost during calibration".into(); break; }
                }
            }
            let _ = reply.send(result);
        }
        Cmd::MagCal { action, reply } => {
            let result = compass_cal(conn, st, &action, on_sample, latest, sitl);
            let _ = reply.send(result);
        }
        Cmd::AccelCalCmd { action, reply } => {
            let result = accel_cal(conn, st, &action, on_sample, latest, sitl);
            let _ = reply.send(result);
        }
        Cmd::CompassMot { action, reply } => {
            let result = compass_mot(conn, st, &action, on_sample, latest, sitl);
            let _ = reply.send(result);
        }
        Cmd::MotorTest { seq, percent, seconds, reply } => {
            let result = motor_test(conn, st, seq, percent, seconds, on_sample, latest, sitl);
            let _ = reply.send(result);
        }
        Cmd::ParamsList => request_param_list(conn, st),
        Cmd::Diagnostics => request_diagnostics(conn, st),
        Cmd::LogList => request_log_list(conn, st),
        Cmd::LogEnd => end_log_request(conn, st),
        Cmd::LogCancel => {
            let full = st.active_log_download.as_ref().is_some_and(|active| active.peek_head == 0);
            if full {
                st.active_log_download = None;
                end_log_request(conn, st);
                if let Some(report) = st.sample.log_download.as_mut() {
                    if !report.complete {
                        report.complete = true;
                        report.error = "Download cancelled".into();
                        report.updated_at = wall_time();
                    }
                }
            }
        }
        Cmd::LogErase => {
            // LOG_ERASE clears the log dataflash only. It is not a parameter reset.
            send_msg(
                conn,
                &MavMessage::LOG_ERASE(LOG_ERASE_DATA {
                    target_system: st.target_system,
                    target_component: st.target_component,
                }),
            );
        }
        Cmd::LogPeek { id, size } => {
            if st.active_log_download.as_ref().is_some_and(|active| active.peek_head == 0) {
                return;
            }
            if st.active_log_download.as_ref().is_some_and(|active| active.id == id && active.peek_head > 0) {
                return;
            }
            if size == 0 {
                fail_log_peek(st, id, 0, "Log is empty");
                return;
            }
            let size = size as usize;
            let peek_head = size.min(LOG_PEEK_HEAD);
            let peek_tail = if size > peek_head {
                (size - peek_head).min(LOG_PEEK_TAIL)
            } else {
                0
            };
            let chunks = size.div_ceil(LOG_BLOCK);
            let now = Instant::now();
            st.active_log_download = Some(ActiveLogDownload {
                id,
                size,
                bytes: vec![0; peek_head + peek_tail],
                received: vec![0; chunks.div_ceil(64)],
                received_chunks: 0,
                started: now,
                last_data: now,
                last_request: now,
                peek_head,
                peek_tail,
            });
            request_log_range(conn, st, id, 0, peek_head);
        }
        Cmd::LogDownload { id } => {
            let Some(entry) = st.sample.logs.iter().find(|entry| entry.id == id).cloned() else {
                st.sample.log_download = Some(LogDownload {
                    id,
                    size: 0,
                    received: 0,
                    complete: true,
                    path: String::new(),
                    error: "Unknown log ID; refresh the log list first".into(),
                    updated_at: wall_time(),
                });
                return;
            };
            let size = entry.size as usize;
            if size == 0 || size > MAX_LOG_BYTES {
                st.sample.log_download = Some(LogDownload {
                    id,
                    size: entry.size,
                    received: 0,
                    complete: true,
                    path: String::new(),
                    error: if size == 0 {
                        "Log is empty".into()
                    } else {
                        "Log exceeds the 512 MiB download limit".into()
                    },
                    updated_at: wall_time(),
                });
                return;
            }
            if st.active_log_download.as_ref().is_some_and(|active| active.id == id && active.peek_head == 0) {
                update_log_download_report(st, String::new());
                return;
            }
            let chunks = size.div_ceil(LOG_BLOCK);
            let now = Instant::now();
            st.active_log_download = Some(ActiveLogDownload {
                id,
                size,
                bytes: vec![0; size],
                received: vec![0; chunks.div_ceil(64)],
                received_chunks: 0,
                started: now,
                last_data: now,
                last_request: now,
                peek_head: 0,
                peek_tail: 0,
            });
            update_log_download_report(st, String::new());
            request_log_range(conn, st, id, 0, size);
        }
        Cmd::ParamReadIndex { index } => send_msg(
            conn,
            &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
                param_index: index,
                target_system: st.target_system,
                target_component: st.target_component,
                param_id: [0; 16],
            }),
        ),
        Cmd::Init { params } => {
            if st.sample.armed {
                return;
            }
            let mut names: Vec<String> = params.keys().cloned().collect();
            names.sort();
            // Frame first. Confirm FRAME_CLASS from the vehicle (not the local
            // cache). Do not reboot: Mission Planner SITL often relaunches with
            // -w, EEPROM is empty, boot prints Frame: UNSUPPORTED. Copter
            // re-inits motors from FRAME_CLASS at 1 Hz while disarmed.
            let mut ordered: Vec<String> = Vec::new();
            for must in ["FRAME_CLASS", "FRAME_TYPE"] {
                if names.iter().any(|n| n == must) {
                    ordered.push(must.to_string());
                }
            }
            ordered.extend(
                names
                    .into_iter()
                    .filter(|n| n != "FRAME_CLASS" && n != "FRAME_TYPE"),
            );
            let extra = usize::from(params.contains_key("FRAME_CLASS"));
            let total = (ordered.len() + extra) as u32;
            let mut done = 0u32;
            st.sample.init_done = 0;
            st.sample.init_total = total;
            emit_sample(on_sample, latest, st, sitl);
            for name in &ordered {
                if let Some(&value) = params.get(name) {
                    if name == "FRAME_CLASS" || name == "FRAME_TYPE" {
                        if !set_param_wait(conn, st, name, value) {
                            st.sample
                                .texts
                                .insert(0, format!("WARNING Init: {name} not confirmed"));
                            st.sample.texts.truncate(256);
                        }
                    } else {
                        set_param_now(conn, st, name, value);
                    }
                    done += 1;
                    st.sample.init_done = done;
                    emit_sample(on_sample, latest, st, sitl);
                }
            }
            if let Some(&v) = params.get("FRAME_CLASS") {
                if !set_param_wait(conn, st, "FRAME_CLASS", v) {
                    st.sample
                        .texts
                        .insert(0, "WARNING Init: FRAME_CLASS not confirmed".into());
                    st.sample.texts.truncate(256);
                }
                done += 1;
                st.sample.init_done = done;
                emit_sample(on_sample, latest, st, sitl);
            }
            let settle = Instant::now() + Duration::from_millis(1200);
            while Instant::now() < settle {
                pump_rx(conn, st);
                std::thread::sleep(Duration::from_millis(50));
            }
            st.sample.init_done = 0;
            st.sample.init_total = 0;
            emit_sample(on_sample, latest, st, sitl);
        }
        Cmd::Preset { name } => {
            let (p, i, d, ang, shape) = match name.as_str() {
                "wool" => (0.027, 0.015, STOCK_D, 2.0, false),
                "hot" => (0.675, STOCK_I, STOCK_D, STOCK_ANG, false),
                _ => (STOCK_P, STOCK_I, STOCK_D, STOCK_ANG, true),
            };
            set_rate_pid(conn, st, p, i, d, Some(ang));
            if shape || name == "stock" {
                set_input_shape(conn, st, STOCK_TC, STOCK_ACC, STOCK_RMAX);
            }
        }
        Cmd::Tune { p, i, d } => set_rate_pid(conn, st, p, i, d, None),
        Cmd::Mode { mode } => {
            if let Some(custom) = mode_custom(&st.sample.frame, &mode) {
                command_long(
                    conn,
                    st.target_system,
                    st.target_component,
                    MavCmd::MAV_CMD_DO_SET_MODE,
                    1.0,
                    custom as f32,
                );
            }
        }
        Cmd::Arm { on } => {
            // GCS disarm is refused while Copter !land_complete / Plane is_flying.
            // 21196 is ArduPilot's force-disarm magic (GCS.h magic_force_arm_disarm_value).
            if !on {
                st.virtual_stick = false;
                st.pulse_until = None;
                st.rc.thr = 0;
            }
            let force = if on { 0.0 } else { 21196.0 };
            for comp in [st.target_component, 1, 0] {
                command_long(
                    conn,
                    st.target_system,
                    comp,
                    MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
                    if on { 1.0 } else { 0.0 },
                    force,
                );
            }
        }
        Cmd::Hover => {
            st.rc.thr = 1550;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
        }
        Cmd::Land => {
            st.rc.thr = 1100;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
        }
        Cmd::Stick {
            roll,
            pitch,
            yaw,
            thr,
        } => {
            st.virtual_stick = true;
            st.rc.roll = pwm(roll, 1500);
            st.rc.pitch = pwm(pitch, 1500);
            st.rc.yaw = pwm(yaw, 1500);
            st.rc.thr = if thr > 0.0 { thr.round() as i32 } else { 0 };
        }
        Cmd::Release => {
            st.virtual_stick = false;
            st.pulse_until = None;
            st.rc.thr = 0;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
            send_msg(
                conn,
                &MavMessage::RC_CHANNELS_OVERRIDE(RC_CHANNELS_OVERRIDE_DATA {
                    chan1_raw: 0,
                    chan2_raw: 0,
                    chan3_raw: 0,
                    chan4_raw: 0,
                    chan5_raw: 0,
                    chan6_raw: 0,
                    chan7_raw: 0,
                    chan8_raw: 0,
                    target_system: st.target_system,
                    target_component: st.target_component,
                }),
            );
        }
        Cmd::Connect { .. } | Cmd::Disconnect | Cmd::SitlStart { .. } | Cmd::SitlStop => {}
        Cmd::Reboot => reboot_fc(conn, st),
        Cmd::RebootBootloader => reboot_to_bootloader(conn, st),
    }
}

fn note_rc(st: &mut LinkState, chans: &[u16]) {
    if st.sample.rc.len() < chans.len() {
        st.sample.rc.resize(chans.len(), 0);
    }
    st.sample.rc[..chans.len()].copy_from_slice(chans);
    if let Some(raw) = read_rc_chan(st, chans, "roll") {
        if (801..2200).contains(&raw) {
            st.rc_in_roll = raw as i32;
        }
    }
    if let Some(raw) = read_rc_chan(st, chans, "pitch") {
        if (801..2200).contains(&raw) {
            st.rc_in_pitch = raw as i32;
        }
    }
    if let Some(raw) = read_rc_chan(st, chans, "yaw") {
        if (801..2200).contains(&raw) {
            st.rc_in_yaw = raw as i32;
        }
    }
    if let Some(raw) = read_rc_chan(st, chans, "thr") {
        if (801..2200).contains(&raw) {
            st.rc_in_thr = raw as i32;
        }
    }
}

fn read_rc_chan(st: &LinkState, msg_chans: &[u16], axis: &str) -> Option<u16> {
    let fallback = match axis {
        "pitch" => 2,
        "yaw" => 4,
        "thr" => 3,
        _ => 1,
    };
    let n = (*st.rcmap.get(axis).unwrap_or(&fallback) as usize).clamp(1, msg_chans.len());
    msg_chans.get(n - 1).copied()
}

fn mag_slot(sample: &mut Sample, id: u8) -> &mut MagCalSlot {
    if let Some(pos) = sample.mag_cal.iter().position(|slot| slot.id == id) {
        return &mut sample.mag_cal[pos];
    }
    sample.mag_cal.push(MagCalSlot::fresh(id));
    let last = sample.mag_cal.len() - 1;
    &mut sample.mag_cal[last]
}

fn note_mag_progress(sample: &mut Sample, id: u8, status: u8, attempt: u8, pct: u8, mask: [u8; 10]) {
    let slot = mag_slot(sample, id);
    slot.status = status;
    slot.attempt = attempt;
    slot.pct = pct;
    slot.mask = mask;
}

fn note_mag_report(
    sample: &mut Sample,
    id: u8,
    status: u8,
    autosaved: u8,
    fitness: f32,
    ofs: [f32; 3],
    diag: [f32; 3],
    offdiag: [f32; 3],
) {
    let slot = mag_slot(sample, id);
    slot.status = status;
    if status == 4 {
        slot.pct = 100;
    }
    slot.fitness = Some(fitness as f64);
    slot.ofs = [ofs[0] as f64, ofs[1] as f64, ofs[2] as f64];
    slot.diag = [diag[0] as f64, diag[1] as f64, diag[2] as f64];
    slot.offdiag = [offdiag[0] as f64, offdiag[1] as f64, offdiag[2] as f64];
    slot.autosaved = Some(autosaved);
}

const ACCEL_POS_SUCCESS: u32 = 16_777_215;
const ACCEL_POS_FAILED: u32 = 16_777_216;

fn accel_face(pos: u32) -> bool {
    (1..=6).contains(&pos) || pos == ACCEL_POS_SUCCESS || pos == ACCEL_POS_FAILED
}

fn note_accel_pos(sample: &mut Sample, pos: u32, at: f64) {
    if !accel_face(pos) {
        return;
    }
    sample.accel_cal.pos = pos;
    sample.accel_cal.at = at;
}

fn accel_cal(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    action: &str,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
) -> String {
    if !st.sample.ok || st.sample.armed || wall_time() - st.sample.heartbeat_at > 3.0 {
        return "Calibration requires a fresh disarmed connection".into();
    }
    if action == "pose" {
        let pos = st.sample.accel_cal.pos;
        if !(1..=6).contains(&pos) {
            return "The vehicle is not asking for a face".into();
        }
        let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
            command: MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS,
            target_system: st.target_system,
            target_component: st.target_component,
            confirmation: 0,
            param1: pos as f32,
            param2: 0.0,
            param3: 0.0,
            param4: 0.0,
            param5: 0.0,
            param6: 0.0,
            param7: 0.0,
        });
        if conn.send(&header(), &message).is_err() {
            return "Could not send calibration command".into();
        }
        return wait_cmd_ack(conn, st, on_sample, latest, sitl, MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS, 5, "Face accepted");
    }
    if action != "start" {
        return "Unsupported calibration".into();
    }
    st.sample.accel_cal = AccelCal { pos: 0, at: 0.0 };
    emit_sample(on_sample, latest, st, sitl);
    let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        command: MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION,
        target_system: st.target_system,
        target_component: st.target_component,
        confirmation: 0,
        param1: 0.0,
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        param5: 1.0,
        param6: 0.0,
        param7: 0.0,
    });
    if conn.send(&header(), &message).is_err() {
        return "Could not send calibration command".into();
    }
    wait_cmd_ack(
        conn,
        st,
        on_sample,
        latest,
        sitl,
        MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION,
        45,
        "Accelerometer calibration started",
    )
}

fn wait_cmd_ack(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
    command: MavCmd,
    seconds: u64,
    ok_message: &str,
) -> String {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut result = "Calibration timed out; check vehicle messages before retrying".to_string();
    while Instant::now() < deadline {
        match conn.recv() {
            Ok((hdr, msg)) => {
                let ack = if hdr.system_id == st.target_system && hdr.component_id == st.target_component {
                    if let MavMessage::COMMAND_ACK(v) = &msg {
                        (v.command == command).then_some(v.result as u8)
                    } else {
                        None
                    }
                } else {
                    None
                };
                handle_msg(st, &hdr, msg);
                emit_sample(on_sample, latest, st, sitl);
                if let Some(code) = ack {
                    if code == 0 {
                        result = ok_message.into();
                        break;
                    }
                    if code != 5 {
                        result = "Calibration rejected or failed; check vehicle messages".into();
                        break;
                    }
                }
            }
            Err(mavlink::error::MessageReadError::Io(e))
                if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                result = "Connection lost during calibration".into();
                break;
            }
        }
    }
    result
}

fn compass_mot(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    action: &str,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
) -> String {
    if action == "finish" {
        let message = MavMessage::COMMAND_ACK(COMMAND_ACK_DATA {
            command: MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION,
            result: MavResult::MAV_RESULT_ACCEPTED,
        });
        if conn.send(&header(), &message).is_err() {
            return "Could not send calibration command".into();
        }
        return "CompassMot finish sent".into();
    }
    if action != "start" {
        return "Unsupported calibration".into();
    }
    if !st.sample.ok || st.sample.armed || wall_time() - st.sample.heartbeat_at > 3.0 {
        return "Calibration requires a fresh disarmed connection".into();
    }
    let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        command: MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION,
        target_system: st.target_system,
        target_component: st.target_component,
        confirmation: 0,
        param1: 0.0,
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        param5: 0.0,
        param6: 1.0,
        param7: 0.0,
    });
    if conn.send(&header(), &message).is_err() {
        return "Could not send calibration command".into();
    }
    wait_cmd_ack(conn, st, on_sample, latest, sitl, MavCmd::MAV_CMD_PREFLIGHT_CALIBRATION, 8, "CompassMot started")
}

fn motor_test(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    seq: u8,
    percent: f32,
    seconds: f32,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
) -> String {
    if !st.sample.ok || wall_time() - st.sample.heartbeat_at > 3.0 {
        return "Calibration requires a fresh disarmed connection".into();
    }
    if st.sample.armed {
        return "Disarm before a motor test".into();
    }
    if !(1..=12).contains(&seq) || !(1.0..=25.0).contains(&percent) || !(1.0..=3.0).contains(&seconds) {
        return "Motor test rejected. Check the vehicle message.".into();
    }
    let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        command: MavCmd::MAV_CMD_DO_MOTOR_TEST,
        target_system: st.target_system,
        target_component: st.target_component,
        confirmation: 0,
        param1: seq as f32,
        param2: 0.0,
        param3: percent,
        param4: seconds,
        param5: 1.0,
        param6: 0.0,
        param7: 0.0,
    });
    if conn.send(&header(), &message).is_err() {
        return "Could not send calibration command".into();
    }
    let result = wait_cmd_ack(conn, st, on_sample, latest, sitl, MavCmd::MAV_CMD_DO_MOTOR_TEST, 8, "Motor test started");
    if result == "Calibration rejected or failed; check vehicle messages" {
        return "Motor test rejected. Check the vehicle message.".into();
    }
    if result.starts_with("Calibration timed out") {
        return "Motor test timed out".into();
    }
    result
}

fn compass_cal(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    action: &str,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
    sitl: &SitlCtl,
) -> String {
    if !st.sample.ok || st.sample.armed || wall_time() - st.sample.heartbeat_at > 3.0 {
        return "Calibration requires a fresh disarmed connection".into();
    }
    let (command, p1, p2, p3) = match action {
        "start" => (MavCmd::MAV_CMD_DO_START_MAG_CAL, 0.0, 1.0, 1.0),
        "cancel" => (MavCmd::MAV_CMD_DO_CANCEL_MAG_CAL, 0.0, 0.0, 0.0),
        "accept" => (MavCmd::MAV_CMD_DO_ACCEPT_MAG_CAL, 0.0, 0.0, 0.0),
        _ => return "Unsupported calibration".into(),
    };
    for (mid, us) in [(MSG_MAG_CAL_PROGRESS, 250_000.0), (MSG_MAG_CAL_REPORT, 500_000.0)] {
        command_long(
            conn,
            st.target_system,
            st.target_component,
            MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL,
            mid,
            us,
        );
    }
    let message = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        command,
        target_system: st.target_system,
        target_component: st.target_component,
        confirmation: 0,
        param1: p1,
        param2: p2,
        param3: p3,
        param4: 0.0,
        param5: 0.0,
        param6: 0.0,
        param7: 0.0,
    });
    if conn.send(&header(), &message).is_err() {
        return "Could not send compass calibration".into();
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut result = "Compass calibration timed out".to_string();
    while Instant::now() < deadline {
        match conn.recv() {
            Ok((hdr, msg)) => {
                let ack = if hdr.system_id == st.target_system && hdr.component_id == st.target_component {
                    if let MavMessage::COMMAND_ACK(v) = &msg {
                        (v.command == command).then_some(v.result as u8)
                    } else {
                        None
                    }
                } else {
                    None
                };
                handle_msg(st, &hdr, msg);
                emit_sample(on_sample, latest, st, sitl);
                if let Some(code) = ack {
                    let ok = code == 0 || (action == "start" && code == 5);
                    if ok && action == "start" {
                        st.sample.mag_cal.clear();
                        result = "Compass calibration started".into();
                    } else if ok && action == "cancel" {
                        for slot in &mut st.sample.mag_cal {
                            if slot.status == 1 || slot.status == 2 || slot.status == 3 {
                                slot.status = 0;
                            }
                        }
                        result = "Compass calibration cancelled".into();
                    } else if ok {
                        result = "Compass calibration accepted".into();
                    } else {
                        result = "Compass calibration was not accepted".into();
                    }
                    emit_sample(on_sample, latest, st, sitl);
                    break;
                }
            }
            Err(mavlink::error::MessageReadError::Io(e))
                if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                result = "Connection lost during calibration".into();
                break;
            }
        }
    }
    result
}

fn handle_msg(st: &mut LinkState, header: &MavHeader, msg: MavMessage) {
    // Ignore telemetry from other vehicles and GCS processes on a shared UDP link.
    if !matches!(&msg, MavMessage::HEARTBEAT(_))
        && (header.system_id != st.target_system || header.component_id != st.target_component)
    {
        return;
    }
    absorb_message(&mut st.sample.live_nums, &msg);
    match &msg {
        MavMessage::COMMAND_LONG(v) if v.command == MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS => {
            note_accel_pos(&mut st.sample, v.param1.round() as u32, wall_time());
        }
        MavMessage::MAG_CAL_PROGRESS(v) => note_mag_progress(
            &mut st.sample,
            v.compass_id,
            v.cal_status as u8,
            v.attempt,
            v.completion_pct,
            v.completion_mask,
        ),
        MavMessage::MAG_CAL_REPORT(v) => note_mag_report(
            &mut st.sample,
            v.compass_id,
            v.cal_status as u8,
            v.autosaved,
            v.fitness,
            [v.ofs_x, v.ofs_y, v.ofs_z],
            [v.diag_x, v.diag_y, v.diag_z],
            [v.offdiag_x, v.offdiag_y, v.offdiag_z],
        ),
        _ => {}
    }
    let diagnostic = match &msg {
        MavMessage::AUTOPILOT_VERSION(v) => Some(("AUTOPILOT_VERSION", serde_json::json!(v))),
        MavMessage::OPTICAL_FLOW(v) => {
            st.sample.flow_x = Some(v.flow_comp_m_x as f64);
            st.sample.flow_y = Some(v.flow_comp_m_y as f64);
            st.sample.flow_q = Some(v.quality as f64);
            Some(("OPTICAL_FLOW", serde_json::json!(v)))
        }
        MavMessage::OPTICAL_FLOW_RAD(v) => Some(("OPTICAL_FLOW_RAD", serde_json::json!(v))),
        MavMessage::DISTANCE_SENSOR(v) => {
            st.sample.rng_m = Some(v.current_distance as f64 / 100.0);
            Some(("DISTANCE_SENSOR", serde_json::json!(v)))
        }
        MavMessage::RANGEFINDER(v) => {
            st.sample.rng_m = Some(v.distance as f64);
            st.sample.rng_v = Some(v.voltage as f64);
            Some(("RANGEFINDER", serde_json::json!(v)))
        }
        MavMessage::SYS_STATUS(v) => Some(("SYS_STATUS", serde_json::json!(v))),
        MavMessage::EKF_STATUS_REPORT(v) => Some(("EKF_STATUS_REPORT", serde_json::json!(v))),
        MavMessage::COMMAND_ACK(v) => Some((
            "COMMAND_ACK",
            serde_json::json!({
                "command": format!("{:?}", v.command), "command_id": v.command as u32,
                "result": format!("{:?}", v.result), "result_id": v.result as u8
            }),
        )),
        MavMessage::STATUSTEXT(v) => Some((
            "STATUSTEXT",
            serde_json::json!({
                "severity": format!("{:?}", v.severity), "text": param_name(&v.text)
            }),
        )),
        _ => None,
    };
    if let Some((kind, data)) = diagnostic {
        let count = st
            .sample
            .telemetry
            .get(kind)
            .and_then(|v| v["count"].as_u64())
            .unwrap_or(0)
            + 1;
        let event = serde_json::json!({"message": kind, "received_at": wall_time(),
            "system_id": header.system_id, "component_id": header.component_id,
            "count": count, "data": data});
        st.sample.telemetry.insert(kind.into(), event.clone());
        if kind == "STATUSTEXT" || kind == "COMMAND_ACK" {
            st.sample.events.insert(0, event);
            st.sample.events.truncate(256);
        }
    }
    st.sample.rx = msg_name(&msg).into();
    match msg {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            custom_mode,
            mavtype,
            autopilot,
            base_mode,
            ..
        }) => {
            if mavtype == MavType::MAV_TYPE_GCS {
                return;
            }
            if autopilot != MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA {
                return;
            }
            let frame = frame_of(mavtype);
            if frame.is_empty() {
                return;
            }
            if header.system_id != 0 {
                st.target_system = header.system_id;
            }
            if header.component_id != 0 {
                st.target_component = header.component_id;
            }
            st.sample.ok = true;
            st.sample.heartbeat_at = wall_time();
            st.sample.frame = frame;
            st.sample.mode = if st.sample.frame == "plane" {
                plane_mode(custom_mode)
            } else {
                copter_mode(custom_mode)
            };
            st.sample.armed = base_mode.contains(MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED);
        }
        MavMessage::ATTITUDE(ATTITUDE_DATA {
            roll,
            pitch,
            yaw,
            rollspeed,
            pitchspeed,
            yawspeed,
            ..
        }) => {
            st.sample.roll = (roll as f64).to_degrees();
            st.sample.pitch = (pitch as f64).to_degrees();
            st.sample.yaw = (yaw as f64).to_degrees();
            if st.sample.des.is_none() {
                st.sample.rate = (rollspeed as f64).to_degrees();
            }
            if st.sample.pitch_des.is_none() {
                st.sample.pitch_rate = (pitchspeed as f64).to_degrees();
            }
            if st.sample.yaw_des.is_none() {
                st.sample.yaw_rate = (yawspeed as f64).to_degrees();
            }
        }
        MavMessage::ATTITUDE_TARGET(ATTITUDE_TARGET_DATA { q, .. }) => {
            // Plane's ATTITUDE_TARGET is QuadPlane-only. Fixed-wing angle
            // setpoint is NAV_CONTROLLER_OUTPUT.nav_roll / nav_pitch.
            if st.sample.frame != "plane" {
                if let Some(ang) = quat_roll_deg(&q) {
                    st.sample.tar = Some(ang);
                    st.have_att_target = true;
                }
                if let Some(ang) = quat_pitch_deg(&q) {
                    st.sample.pitch_tar = Some(ang);
                    st.have_att_target = true;
                }
                if let Some(ang) = quat_yaw_deg(&q) {
                    st.sample.yaw_tar = Some(ang);
                    st.have_att_target = true;
                }
            }
        }
        MavMessage::NAV_CONTROLLER_OUTPUT(NAV_CONTROLLER_OUTPUT_DATA {
            nav_roll,
            nav_pitch,
            alt_error,
            ..
        }) => {
            if st.sample.frame == "plane" || !st.have_att_target {
                st.sample.tar = Some(nav_roll as f64);
                st.sample.pitch_tar = Some(nav_pitch as f64);
            }
            st.alt_error = Some(alt_error as f64);
            apply_d_targets(st);
        }
        MavMessage::PID_TUNING(PID_TUNING_DATA {
            axis,
            desired,
            achieved,
            P,
            I,
            D,
            ..
        }) => match axis {
            PidTuningAxis::PID_TUNING_ROLL => {
                st.sample.des = Some(desired as f64);
                st.sample.rate = achieved as f64;
                st.sample.p = Some(P as f64);
                st.sample.i = Some(I as f64);
                st.sample.d = Some(D as f64);
            }
            PidTuningAxis::PID_TUNING_PITCH => {
                st.sample.pitch_des = Some(desired as f64);
                st.sample.pitch_rate = achieved as f64;
                st.sample.pitch_p = Some(P as f64);
                st.sample.pitch_i = Some(I as f64);
                st.sample.pitch_d = Some(D as f64);
            }
            PidTuningAxis::PID_TUNING_YAW => {
                st.sample.yaw_des = Some(desired as f64);
                st.sample.yaw_rate = achieved as f64;
                st.sample.yaw_p = Some(P as f64);
                st.sample.yaw_i = Some(I as f64);
                st.sample.yaw_d = Some(D as f64);
            }
            _ => {}
        },
        MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
            relative_alt, vz, ..
        }) => {
            st.sample.alt = Some(relative_alt as f64 / 1000.0);
            st.sample.climb = Some(-(vz as f64) / 100.0);
            apply_d_targets(st);
        }
        MavMessage::VFR_HUD(VFR_HUD_DATA {
            airspeed,
            groundspeed,
            heading,
            throttle,
            climb,
            ..
        }) => {
            st.sample.aspd = Some(airspeed as f64);
            st.sample.gspd = Some(groundspeed as f64);
            st.sample.hdg = Some(heading as f64);
            st.sample.thr_out = Some(throttle as f64);
            if st.sample.climb.is_none() {
                st.sample.climb = Some(climb as f64);
            }
        }
        MavMessage::RC_CHANNELS(RC_CHANNELS_DATA {
            chan1_raw,
            chan2_raw,
            chan3_raw,
            chan4_raw,
            chan5_raw,
            chan6_raw,
            chan7_raw,
            chan8_raw,
            chan9_raw,
            chan10_raw,
            chan11_raw,
            chan12_raw,
            chan13_raw,
            chan14_raw,
            chan15_raw,
            chan16_raw,
            chan17_raw,
            chan18_raw,
            ..
        }) => {
            note_rc(
                st,
                &[
                    chan1_raw, chan2_raw, chan3_raw, chan4_raw, chan5_raw, chan6_raw, chan7_raw,
                    chan8_raw, chan9_raw, chan10_raw, chan11_raw, chan12_raw, chan13_raw, chan14_raw,
                    chan15_raw, chan16_raw, chan17_raw, chan18_raw,
                ],
            );
        }
        MavMessage::RC_CHANNELS_RAW(RC_CHANNELS_RAW_DATA {
            chan1_raw,
            chan2_raw,
            chan3_raw,
            chan4_raw,
            chan5_raw,
            chan6_raw,
            chan7_raw,
            chan8_raw,
            ..
        }) => {
            note_rc(
                st,
                &[
                    chan1_raw, chan2_raw, chan3_raw, chan4_raw, chan5_raw, chan6_raw, chan7_raw,
                    chan8_raw,
                ],
            );
        }
        MavMessage::LOG_ENTRY(LOG_ENTRY_DATA {
            id,
            num_logs,
            last_log_num,
            time_utc,
            size,
        }) => {
            st.sample.log_list_at = wall_time();
            st.sample.log_list_expected = Some(num_logs);
            if num_logs == 0 {
                st.sample.logs.clear();
                return;
            }
            let entry = OnboardLog {
                id,
                num_logs,
                last_log_num,
                time_utc,
                size,
            };
            if let Some(existing) = st.sample.logs.iter_mut().find(|item| item.id == id) {
                *existing = entry;
            } else {
                st.sample.logs.push(entry);
                st.sample.logs.sort_by_key(|item| item.id);
            }
        }
        MavMessage::LOG_DATA(LOG_DATA_DATA {
            id,
            ofs,
            count,
            data,
        }) => {
            let Some(active) = st.active_log_download.as_mut() else {
                return;
            };
            if id != active.id || count == 0 {
                return;
            }
            let offset = ofs as usize;
            if offset >= active.size {
                return;
            }
            let end = (offset + count as usize)
                .min(active.size)
                .min(offset + data.len());
            if end <= offset {
                return;
            }
            write_log_bytes(active, offset, &data[..end - offset]);
            let first_chunk = offset / LOG_BLOCK;
            let last_chunk = (end - 1) / LOG_BLOCK;
            for chunk in first_chunk..=last_chunk {
                if mark_log_bit(&mut active.received, chunk) {
                    active.received_chunks += 1;
                }
            }
            active.last_data = Instant::now();
            update_log_download_report(st, String::new());
        }
        MavMessage::STATUSTEXT(STATUSTEXT_DATA { severity, text, .. }) => {
            let msg = param_name(&text);
            if msg.is_empty() {
                return;
            }
            if let Some((name, uid)) = boot_identity(&msg) {
                st.sample.board_name = name;
                st.sample.boot_uid = uid;
            }
            let sev = format!("{severity:?}").replace("MAV_SEVERITY_", "");
            st.sample.texts.insert(0, format!("{sev} {msg}"));
            st.sample.texts.truncate(256);
        }
        MavMessage::PARAM_VALUE(PARAM_VALUE_DATA {
            param_id,
            param_value,
            param_count,
            param_index,
            ..
        }) => {
            let name = param_name(&param_id);
            if name.is_empty() {
                return;
            }
            let val = param_value as f64;
            st.sample.params.insert(name.clone(), val);
            st.sample.param_received.insert(name.clone(), wall_time());
            st.sample.param_count = param_count;
            if param_index < param_count {
                st.sample.param_indices.insert(param_index);
            }
            store_received_param(st, &name, val);
            match name.as_str() {
                "ATC_RAT_RLL_P" => st.sample.gain_p = Some(val),
                "ATC_RAT_RLL_I" => st.sample.gain_i = Some(val),
                "ATC_RAT_RLL_D" => st.sample.gain_d = Some(val),
                "ANGLE_MAX" | "ATC_ANGLE_MAX" => {
                    if val > 50.0 {
                        st.angle_max = val / 100.0;
                    } else {
                        st.angle_max = val;
                    }
                }
                "RCMAP_ROLL" => {
                    st.rcmap.insert("roll", val as u8);
                }
                "RCMAP_PITCH" => {
                    st.rcmap.insert("pitch", val as u8);
                }
                "RCMAP_THROTTLE" => {
                    st.rcmap.insert("thr", val as u8);
                }
                "RCMAP_YAW" => {
                    st.rcmap.insert("yaw", val as u8);
                }
                "ATC_INPUT_TC" => st.sample.input_tc = Some(val),
                "ATC_ACC_R_MAX" => st.sample.acc_max = Some(val),
                "ATC_RATE_R_MAX" => st.sample.rate_max = Some(val),
                _ => {}
            }
        }
        _ => {}
    }
}

fn boot_identity(message: &str) -> Option<(String, String)> {
    let mut words = message.split_whitespace();
    let name = words.next()?;
    if !name.contains('_') || name.len() > 64 {
        return None;
    }
    let uid = words
        .filter(|part| {
            part.len() >= 4 && part.len() <= 16 && part.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .collect::<String>();
    Some((name.to_owned(), uid))
}

fn msg_name(msg: &MavMessage) -> &'static str {
    match msg {
        MavMessage::HEARTBEAT(_) => "HEARTBEAT",
        MavMessage::ATTITUDE(_) => "ATTITUDE",
        MavMessage::ATTITUDE_TARGET(_) => "ATTITUDE_TARGET",
        MavMessage::PID_TUNING(_) => "PID_TUNING",
        MavMessage::PARAM_VALUE(_) => "PARAM_VALUE",
        MavMessage::STATUSTEXT(_) => "STATUSTEXT",
        MavMessage::GLOBAL_POSITION_INT(_) => "GLOBAL_POSITION_INT",
        MavMessage::VFR_HUD(_) => "VFR_HUD",
        MavMessage::RC_CHANNELS(_) => "RC_CHANNELS",
        MavMessage::NAV_CONTROLLER_OUTPUT(_) => "NAV_CONTROLLER_OUTPUT",
        _ => "MSG",
    }
}
