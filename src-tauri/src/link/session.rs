// Opening the link and the read loop.


/// Extra GCS ports. 5760 is SERIAL0; do not wander off it onto 5762/5763.
fn sitl_alt_urls(url: &str) -> Vec<String> {
    let Some(("tcpout", rest)) = url.split_once(':') else {
        return Vec::new();
    };
    let Some((host, port)) = rest.rsplit_once(':') else {
        return Vec::new();
    };
    if host != "127.0.0.1" && host != "localhost" {
        return Vec::new();
    }
    if port == "5760" || port == "5770" {
        return Vec::new();
    }
    ["5763", "5762"]
        .into_iter()
        .filter(|p| *p != port)
        .map(|p| format!("tcpout:{host}:{p}"))
        .collect()
}

#[derive(Clone, Copy)]
enum OpenErr {
    Connect,
    AddrInUse,
    NoHeartbeat,
}

fn open_conn(url: &str) -> Result<Box<dyn MavConnection<MavMessage> + Send + Sync>, OpenErr> {
    let udp = url.len() >= 3 && url[..3].eq_ignore_ascii_case("udp");
    let io_err = |err: std::io::Error| {
        if err.kind() == std::io::ErrorKind::AddrInUse {
            OpenErr::AddrInUse
        } else {
            OpenErr::Connect
        }
    };
    #[cfg(not(target_os = "android"))]
    if strip_prefix_ci(url, "serial:").is_some() {
        let conn = crate::serial_link::connect(url).map_err(io_err)?;
        return Ok(Box::new(crate::tlog::LoggedConn::new(conn)));
    }
    let conn = if udp {
        crate::udp::connect(url).map_err(io_err)?
    } else {
        mavlink::connect::<MavMessage>(url).map_err(io_err)?
    };
    Ok(Box::new(crate::tlog::LoggedConn::new(conn)))
}

fn try_open(url: &str) -> Result<Box<dyn MavConnection<MavMessage> + Send + Sync>, OpenErr> {
    let mut conn = open_conn(url)?;
    conn.set_protocol_version(mavlink::MavlinkVersion::V2);
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        let _ = conn.send(&header(), &gcs_heartbeat());
        match conn.recv() {
            Ok((_hdr, MavMessage::HEARTBEAT(hb))) => {
                if hb.mavtype != MavType::MAV_TYPE_GCS
                    && hb.autopilot == MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA
                {
                    return Ok(conn);
                }
            }
            Ok(_) => {}
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err(OpenErr::Connect),
        }
    }
    Err(OpenErr::NoHeartbeat)
}

fn is_udp(url: &str) -> bool {
    url.len() >= 3 && url[..3].eq_ignore_ascii_case("udp")
}

fn serial_url(url: &str) -> bool {
    strip_prefix_ci(url, "serial:").is_some()
}

/// Serial keeps the COM handle for the whole attempt. Retrying it forever
/// blocks the bootloader, so a failed or dropped COM link stays down.
fn give_up_serial(url: &Mutex<String>) {
    if let Ok(mut g) = url.lock() {
        if serial_url(&g) {
            g.clear();
        }
    }
}

fn open_link(
    url: &str,
) -> Result<(Box<dyn MavConnection<MavMessage> + Send + Sync>, String), OpenErr> {
    // UDP has no connect handshake. Keep the socket up and wait for HEARTBEAT in the read loop.
    // Closing it after a few seconds changes the source port, so the vehicle's reply is lost.
    if is_udp(url) {
        let conn = open_conn(url)?;
        crate::tlog::begin();
        return Ok((conn, url.to_string()));
    }
    let mut last = OpenErr::Connect;
    for candidate in std::iter::once(url.to_string()).chain(sitl_alt_urls(url)) {
        match try_open(&candidate) {
            Ok(conn) => {
                crate::tlog::begin();
                return Ok((conn, candidate));
            }
            Err(err) => last = err,
        }
    }
    Err(last)
}

pub type OnSample = Arc<dyn Fn(&Sample) + Send + Sync>;

fn emit_sample(on_sample: &OnSample, latest: &Mutex<Sample>, st: &LinkState, sitl: &SitlCtl) {
    let mut s = if let Ok(mut g) = latest.lock() {
        *g = st.sample.clone();
        sitl.write_into(&mut g);
        g.clone()
    } else {
        let mut s = st.sample.clone();
        sitl.write_into(&mut s);
        s
    };
    note_live(&mut s);
    on_sample(&s);
}

fn note_param_identity(st: &mut LinkState) {
    if st.sample.params.is_empty() {
        return;
    }
    let key = crate::db::vehicle_cache_key(&st.sample.frame, &st.sample.board_name, &st.sample.boot_uid);
    if key == st.params_cache_key {
        return;
    }
    st.params_cache_key = key;
    st.params_cache_full = false;
    let full = st.sample.param_count > 0 && st.sample.param_indices.len() >= st.sample.param_count as usize;
    if full {
        remember_vehicle_params(st);
    }
}

fn store_received_param(st: &mut LinkState, name: &str, value: f64) {
    let key = crate::db::vehicle_cache_key(&st.sample.frame, &st.sample.board_name, &st.sample.boot_uid);
    if st.params_cache_key != key {
        st.params_cache_key = key;
        st.params_cache_full = false;
    }
    let full = st.sample.param_count > 0 && st.sample.param_indices.len() >= st.sample.param_count as usize;
    if full && st.params_cache_full {
        let _ = crate::db::remember_param(&st.sample.frame, &st.sample.board_name, &st.sample.boot_uid, name, value);
        return;
    }
    remember_vehicle_params(st);
}

fn fill_missing_params(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState, now: Instant) {
    if st.sample.heartbeat_at <= 0.0 {
        return;
    }
    let full = st.sample.param_count > 0 && st.sample.param_indices.len() >= st.sample.param_count as usize;
    if full {
        return;
    }
    if st.sample.param_count == 0 {
        if now.duration_since(st.params_fill_at) < Duration::from_secs(2) {
            return;
        }
        st.params_fill_at = now;
        if st.params_list_tries < 6 {
            request_param_list(conn, st);
            st.params_list_tries = st.params_list_tries.saturating_add(1);
        }
        return;
    }
    if now.duration_since(st.params_fill_at) < Duration::from_millis(500) {
        return;
    }
    st.params_fill_at = now;
    let missing: Vec<u16> = (0..st.sample.param_count)
        .filter(|index| !st.sample.param_indices.contains(index))
        .take(24)
        .collect();
    for index in missing {
        send_msg(
            conn,
            &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
                param_index: index as i16,
                target_system: st.target_system,
                target_component: st.target_component,
                param_id: [0; 16],
            }),
        );
    }
}

fn remember_vehicle_params(st: &mut LinkState) {
    if st.sample.params.is_empty() {
        return;
    }
    let now = wall_time();
    let full = st.sample.param_count > 0 && st.sample.param_indices.len() >= st.sample.param_count as usize;
    let just_full = full && !st.params_cache_full;
    if !just_full && now - st.params_cached_at < 2.0 {
        return;
    }
    let replace = just_full;
    if crate::db::remember_params(&st.sample.frame, &st.sample.board_name, &st.sample.boot_uid, &st.sample.params, replace).is_ok() {
        st.params_cached_at = now;
        if full {
            st.params_cache_full = true;
        }
    }
}

fn wall_time() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

enum Drain {
    None,
    Reconnect,
    Stop,
}

fn drain_cmds(
    cmds: &Mutex<Receiver<Cmd>>,
    url: &Mutex<String>,
    conn: Option<&dyn MavConnection<MavMessage>>,
    st: &mut LinkState,
    on_sample: &OnSample,
    latest: &Arc<Mutex<Sample>>,
    sitl: &Arc<SitlCtl>,
) -> Drain {
    if let Some(u) = sitl.take_connect() {
        let mut g = url.lock().unwrap();
        *g = u;
        return Drain::Reconnect;
    }
    let rx = cmds.lock().unwrap();
    loop {
        match rx.try_recv() {
            Ok(Cmd::Connect { url: u }) => {
                let n = normalize_link(&u);
                let mut g = url.lock().unwrap();
                *g = n;
                return Drain::Reconnect;
            }
            Ok(Cmd::Disconnect) => {
                let mut g = url.lock().unwrap();
                if g.is_empty() {
                    continue;
                }
                g.clear();
                return Drain::Reconnect;
            }
            Ok(Cmd::SitlStart {
                vehicle,
                wipe,
                home,
                speedup,
            }) => {
                sitl.start(
                    SitlOpts {
                        vehicle,
                        wipe,
                        home,
                        speedup,
                    },
                    Arc::clone(latest),
                );
                sitl.write_into(&mut st.sample);
                emit_sample(on_sample, latest, st, sitl);
            }
            Ok(Cmd::RebootBootloader) => {
                if let Some(conn) = conn {
                    reboot_to_bootloader(conn, st);
                }
                // USB telemetry and the uploader cannot share the port. Drop it
                // and leave the address in place; the outer loop waits until the
                // flash lock is gone, then connects again.
                if serial_url(&url.lock().map(|g| g.clone()).unwrap_or_default()) {
                    st.sample.ok = false;
                    st.sample.detail = "USB зайнятий прошивкою".into();
                    emit_sample(on_sample, latest, st, sitl);
                    give_up_serial(url);
                    return Drain::Reconnect;
                }
            }
            Ok(Cmd::SitlStop) => {
                sitl.stop();
                sitl.write_into(&mut st.sample);
                emit_sample(on_sample, latest, st, sitl);
                let mut g = url.lock().unwrap();
                g.clear();
                return Drain::Reconnect;
            }
            Ok(cmd) => {
                if let Some(conn) = conn {
                    apply_cmd(conn, st, cmd, on_sample, latest, sitl);
                } else if let Cmd::ParamsRestore { reply, .. } = cmd {
                    let _ = reply.send(Err("Restore requires a fresh disarmed connection".into()));
                }
            }
            Err(TryRecvError::Empty) => return Drain::None,
            Err(TryRecvError::Disconnected) => return Drain::Stop,
        }
    }
}

pub fn run_loop(
    on_sample: OnSample,
    cmds: Receiver<Cmd>,
    latest: Arc<Mutex<Sample>>,
    url: Arc<Mutex<String>>,
    sitl: Arc<SitlCtl>,
) {
    let cmds = Mutex::new(cmds);
    sitl.adopt(Arc::clone(&latest));
    loop {
        let mut st = LinkState::new();
        let target = url.lock().map(|g| g.clone()).unwrap_or_default();
        if target.is_empty() {
            st.sample.ok = false;
            st.sample.detail = "відключено".into();
            emit_sample(&on_sample, &latest, &st, &sitl);
            loop {
                match drain_cmds(&cmds, &url, None, &mut st, &on_sample, &latest, &sitl) {
                    Drain::None => std::thread::sleep(Duration::from_millis(50)),
                    Drain::Reconnect => break,
                    Drain::Stop => return,
                }
            }
            continue;
        }
        if serial_url(&target) && crate::firmware_native::flash_in_progress() {
            st.sample.ok = false;
            st.sample.detail = "USB зайнятий прошивкою".into();
            emit_sample(&on_sample, &latest, &st, &sitl);
            let mut user_left = false;
            loop {
                match drain_cmds(&cmds, &url, None, &mut st, &on_sample, &latest, &sitl) {
                    Drain::None => std::thread::sleep(Duration::from_millis(50)),
                    Drain::Reconnect => {
                        user_left = true;
                        break;
                    }
                    Drain::Stop => return,
                }
                if !crate::firmware_native::flash_in_progress() {
                    break;
                }
            }
            if !user_left {
                give_up_serial(&url);
            }
            continue;
        }
        st.sample.ok = false;
        st.sample.detail = format!("чекаємо HEARTBEAT ({target})");
        emit_sample(&on_sample, &latest, &st, &sitl);
        let conn = match open_link(&target) {
            Ok((c, actual)) => {
                if actual != target {
                    if let Ok(mut g) = url.lock() {
                        *g = actual.clone();
                    }
                }
                if is_udp(&actual) {
                    st.sample.ok = false;
                    st.sample.detail = format!("чекаємо HEARTBEAT ({actual})");
                } else {
                    st.sample.detail = actual;
                    st.sample.rx = "heartbeat".into();
                    st.sample.ok = true;
                }
                Some(c)
            }
            Err(OpenErr::NoHeartbeat) => {
                st.sample.ok = false;
                st.sample.detail = format!("немає HEARTBEAT ({target})");
                None
            }
            Err(OpenErr::AddrInUse) => {
                st.sample.ok = false;
                st.sample.detail = format!("порт зайнятий ({target})");
                None
            }
            Err(OpenErr::Connect) => {
                st.sample.ok = false;
                st.sample.detail = format!("немає MAVLink ({target})");
                None
            }
        };
        let Some(conn) = conn else {
            emit_sample(&on_sample, &latest, &st, &sitl);
            if serial_url(&target) {
                give_up_serial(&url);
                continue;
            }
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                match drain_cmds(&cmds, &url, None, &mut st, &on_sample, &latest, &sitl) {
                    Drain::None => std::thread::sleep(Duration::from_millis(50)),
                    Drain::Reconnect => break,
                    Drain::Stop => return,
                }
            }
            continue;
        };

        // UDP has no learned peer until a heartbeat arrives. Initial broadcast
        // parameter requests used to be lost, leaving an almost empty cache.
        let mut requested_initial = false;

        let mut last_rc = Instant::now() - Duration::from_millis(50);
        let mut last_stream = Instant::now();
        let mut last_hb = Instant::now();
        let mut last_emit = Instant::now() - Duration::from_millis(40);
        let mut att_n = 0u32;
        let mut att_t0 = Instant::now();
        let mut last_att: Option<Instant> = None;

        loop {
            match drain_cmds(
                &cmds,
                &url,
                Some(&*conn),
                &mut st,
                &on_sample,
                &latest,
                &sitl,
            ) {
                Drain::None => {}
                Drain::Reconnect => break,
                Drain::Stop => {
                    crate::tlog::end();
                    return;
                }
            }

            let now = Instant::now();
            st.sample.t = wall_time();
            st.sample.cmd = stick_deg(&st, axis_pwm(&st, false));
            st.sample.pitch_cmd = stick_deg(&st, axis_pwm(&st, true));
            // Same ±ANGLE_MAX throw as roll. Upper yaw plot adds this to heading
            // so the grey line sits on actual at rest and peels off with the stick.
            st.sample.yaw_cmd = stick_deg(&st, yaw_pwm(&st));
            st.sample.thr_cmd = thr_pct(thr_pwm(&st));
            apply_d_targets(&mut st);
            if now.duration_since(att_t0) >= Duration::from_secs(1) {
                st.sample.att_hz = att_n;
                att_n = 0;
                att_t0 = now;
            }
            if st.sample.heartbeat_at > 0.0
                && now.duration_since(last_stream) > Duration::from_secs(3)
                && st.sample.att_hz == 0
            {
                request_streams(&*conn, &st);
                last_stream = now;
            }
            if let Some(t) = last_att {
                if now.duration_since(t) > Duration::from_secs(12) {
                    st.sample.ok = false;
                    let serial = url.lock().ok().is_some_and(|g| serial_url(&g));
                    st.sample.detail = if serial {
                        "немає ATTITUDE".into()
                    } else {
                        "немає ATTITUDE, reconnect".into()
                    };
                    emit_sample(&on_sample, &latest, &st, &sitl);
                    if serial {
                        give_up_serial(&url);
                    }
                    break;
                }
            }
            if now.duration_since(last_rc) > Duration::from_millis(50) {
                send_rc(&*conn, &st);
                last_rc = now;
            }
            if now.duration_since(last_hb) > Duration::from_secs(1) {
                send_msg(&*conn, &gcs_heartbeat());
                last_hb = now;
            }
            drive_log_download(&*conn, &mut st);
            if requested_initial {
                note_param_identity(&mut st);
                fill_missing_params(&*conn, &mut st, now);
            }

            match conn.recv() {
                Ok((hdr, msg)) => {
                    let is_att = matches!(msg, MavMessage::ATTITUDE(_));
                    handle_msg(&mut st, &hdr, msg);
                    if !requested_initial && st.sample.heartbeat_at > 0.0 {
                        request_streams(&*conn, &st);
                        request_params(&*conn, &st);
                        request_diagnostics(&*conn, &st);
                        requested_initial = true;
                    }
                    if st.sample.ok && st.sample.detail.starts_with("чекаємо HEARTBEAT") {
                        st.sample.detail = target.clone();
                    }
                    if is_att {
                        att_n += 1;
                        last_att = Some(Instant::now());
                    } else if last_att.is_none() && st.sample.frame != "" {
                        last_att = Some(Instant::now());
                    }
                }
                Err(mavlink::error::MessageReadError::Io(err))
                    if err.kind() == std::io::ErrorKind::TimedOut
                        || err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => {
                    st.sample.ok = false;
                    st.sample.detail = "лінк обірвався".into();
                    emit_sample(&on_sample, &latest, &st, &sitl);
                    break;
                }
            }

            if now.duration_since(last_emit) >= Duration::from_millis(40) {
                emit_sample(&on_sample, &latest, &st, &sitl);
                last_emit = now;
            }
        }
        crate::tlog::end();
    }
}
