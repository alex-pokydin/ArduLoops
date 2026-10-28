// Tests.


#[cfg(test)]
mod script_names {
    use super::{parse_dir_entries, script_file_name};

    #[test]
    fn a_script_name_is_one_lua_file() {
        assert!(script_file_name("hello.lua").is_ok());
        assert!(script_file_name("Hello_1.lua").is_ok());
        assert!(script_file_name("../hello.lua").is_err());
        assert!(script_file_name("scripts/hello.lua").is_err());
        assert!(script_file_name("hello.txt").is_err());
        assert!(script_file_name(".lua").is_err());
    }

    #[test]
    fn a_directory_page_keeps_files() {
        let raw = b"Fhello.lua\t12\0Dmodules\0Fskip\0";
        let rows = parse_dir_entries(raw);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, 'F');
        assert_eq!(rows[0].name, "hello.lua");
        assert_eq!(rows[0].bytes, 12);
        assert_eq!(rows[1].kind, 'D');
        assert_eq!(rows[1].name, "modules");
    }
}


#[cfg(test)]
mod normalize_tests {
    use super::normalize_link;

    #[test]
    fn mavlink_udp_port_is_not_tcp() {
        assert_eq!(
            normalize_link("192.168.6.167:14550"),
            "udpout:192.168.6.167:14550"
        );
        assert_eq!(
            normalize_link("tcpout:192.168.6.167:5760"),
            "tcpout:192.168.6.167:5760"
        );
        assert_eq!(normalize_link("udp:14550"), "udpin:0.0.0.0:14550");
    }
}

#[cfg(test)]
mod diagnostics_tests {
    use super::*;
    use mavlink::ardupilotmega::{MavResult, COMMAND_ACK_DATA, OPTICAL_FLOW_DATA};

    #[test]
    fn flowhold_mode_roundtrip() {
        assert_eq!(mode_custom("copter", "FLOWHOLD"), Some(22));
        assert_eq!(copter_mode(22), "FLOWHOLD");
        assert_eq!(mode_custom("plane", "FLOWHOLD"), None);
        assert_eq!(mode_custom("copter", "TYPO"), None);
    }

    #[test]
    fn diagnostics_keep_ack_and_live_flow_but_ignore_other_vehicles() {
        let mut st = LinkState::new();
        let hdr = MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        };
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::COMMAND_ACK(COMMAND_ACK_DATA {
                command: MavCmd::MAV_CMD_DO_SET_MODE,
                result: MavResult::MAV_RESULT_FAILED,
            }),
        );
        assert_eq!(
            st.sample.events[0]["data"]["command"],
            "MAV_CMD_DO_SET_MODE"
        );
        assert_eq!(st.sample.events[0]["data"]["result"], "MAV_RESULT_FAILED");
        let flow = MavMessage::OPTICAL_FLOW(OPTICAL_FLOW_DATA {
            quality: 123,
            ..Default::default()
        });
        handle_msg(&mut st, &hdr, flow.clone());
        handle_msg(
            &mut st,
            &MavHeader {
                system_id: 2,
                ..hdr
            },
            flow,
        );
        assert_eq!(st.sample.telemetry["OPTICAL_FLOW"]["count"], 1);
        assert_eq!(st.sample.telemetry["OPTICAL_FLOW"]["data"]["quality"], 123);
        assert_eq!(st.sample.flow_q, Some(123.0));
        assert_eq!(st.sample.events.len(), 1);
    }
}

#[cfg(test)]
mod live_buffer_tests {
    use super::{handle_msg, live_meta, wall_time, with_live_cleared, LinkState, Sample};
    use mavlink::ardupilotmega::{
        ATTITUDE_DATA, DISTANCE_SENSOR_DATA, GLOBAL_POSITION_INT_DATA, OPTICAL_FLOW_DATA, RANGEFINDER_DATA,
        SIM_STATE_DATA, SIMSTATE_DATA, MavMessage,
    };
    use mavlink::MavHeader;

    #[test]
    fn bitflags_and_prearm_lines_reach_the_sample() {
        use mavlink::ardupilotmega::{
            EkfStatusFlags, MavSeverity, MavSysStatusSensor, EKF_STATUS_REPORT_DATA, STATUSTEXT_DATA, SYS_STATUS_DATA,
        };
        let mut st = LinkState::new();
        let hdr = MavHeader { system_id: 1, component_id: 1, sequence: 0 };
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::SYS_STATUS(SYS_STATUS_DATA {
                onboard_control_sensors_health: MavSysStatusSensor::MAV_SYS_STATUS_PREARM_CHECK,
                voltage_battery: 12400,
                ..Default::default()
            }),
        );
        assert_eq!(
            st.sample.live_nums.get("SYS_STATUS.onboard_control_sensors_health"),
            Some(&(MavSysStatusSensor::MAV_SYS_STATUS_PREARM_CHECK.bits() as f64))
        );
        assert_eq!(st.sample.live_nums.get("SYS_STATUS.voltage_battery"), Some(&12400.0));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::EKF_STATUS_REPORT(EKF_STATUS_REPORT_DATA {
                flags: EkfStatusFlags::EKF_ATTITUDE,
                ..Default::default()
            }),
        );
        assert_eq!(st.sample.live_nums.get("EKF_STATUS_REPORT.flags"), Some(&(EkfStatusFlags::EKF_ATTITUDE.bits() as f64)));

        let text = |s: &str| {
            let mut buf = [0u8; 50];
            buf[..s.len()].copy_from_slice(s.as_bytes());
            MavMessage::STATUSTEXT(STATUSTEXT_DATA { severity: MavSeverity::MAV_SEVERITY_CRITICAL, text: buf, ..Default::default() })
        };
        handle_msg(&mut st, &hdr, text("PreArm: Compass not calibrated"));
        handle_msg(&mut st, &hdr, text("PreArm: Battery 1 below minimum arming voltage"));
        handle_msg(&mut st, &hdr, text("PreArm: Compass not calibrated"));
        handle_msg(&mut st, &hdr, text("EKF3 IMU0 is using GPS"));
        let lines: Vec<&str> = st.sample.prearm.iter().map(|line| line.text.as_str()).collect();
        assert_eq!(lines, ["PreArm: Compass not calibrated", "PreArm: Battery 1 below minimum arming voltage"]);
        assert!(st.sample.prearm.iter().all(|line| line.at > 0.0));
    }

    #[test]
    fn rangefinder_and_flow_land_on_the_sample() {
        let mut st = LinkState::new();
        let hdr = MavHeader { system_id: 1, component_id: 1, sequence: 0 };
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::DISTANCE_SENSOR(DISTANCE_SENSOR_DATA {
                current_distance: 240,
                ..Default::default()
            }),
        );
        assert_eq!(st.sample.rng_m, Some(2.4));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::RANGEFINDER(RANGEFINDER_DATA {
                distance: 1.5,
                voltage: 1.0,
                ..Default::default()
            }),
        );
        assert_eq!(st.sample.rng_m, Some(1.5));
        assert_eq!(st.sample.rng_v, Some(1.0));
        assert!(st.sample.telemetry.contains_key("RANGEFINDER"));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::OPTICAL_FLOW(OPTICAL_FLOW_DATA {
                flow_comp_m_x: 0.25,
                flow_comp_m_y: -0.5,
                quality: 90,
                ..Default::default()
            }),
        );
        assert_eq!(st.sample.flow_x, Some(0.25));
        assert_eq!(st.sample.flow_y, Some(-0.5));
        assert_eq!(st.sample.flow_q, Some(90.0));
        assert_eq!(st.sample.live_nums.get("OPTICAL_FLOW.quality"), Some(&90.0));
        assert_eq!(st.sample.live_nums.get("OPTICAL_FLOW.flow_comp_m_x"), Some(&0.25));
        assert_eq!(st.sample.live_nums.get("DISTANCE_SENSOR.current_distance"), Some(&240.0));
        assert!(st.sample.live_nums.contains_key("DISTANCE_SENSOR.min_distance"));
        assert_eq!(st.sample.live_nums.get("RANGEFINDER.voltage"), Some(&1.0));
        assert_eq!(st.sample.live_nums.get("RANGEFINDER.distance"), Some(&1.5));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::ATTITUDE(ATTITUDE_DATA { roll: 0.5, ..Default::default() }),
        );
        assert!((st.sample.roll - 0.5_f64.to_degrees()).abs() < 1e-6);
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
                lat: -353_632_611,
                lon: 1_491_652_371,
                relative_alt: 12_340,
                ..Default::default()
            }),
        );
        assert!((st.sample.lat.unwrap_or(0.0) + 35.3632611).abs() < 1e-6);
        assert!((st.sample.lon.unwrap_or(0.0) - 149.1652371).abs() < 1e-6);
        assert!((st.sample.alt.unwrap_or(0.0) - 12.34).abs() < 1e-6);
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::SIMSTATE(SIMSTATE_DATA {
                lat: -353_632_000,
                lng: 1_491_652_000,
                ..Default::default()
            }),
        );
        assert!((st.sample.truth_lat.unwrap_or(0.0) + 35.3632).abs() < 1e-6);
        assert!((st.sample.truth_lon.unwrap_or(0.0) - 149.1652).abs() < 1e-6);
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::SIM_STATE(SIM_STATE_DATA {
                lat: -353_632_610.0,
                lon: 1_491_652_300.0,
                ..Default::default()
            }),
        );
        assert!((st.sample.truth_lat.unwrap_or(0.0) + 35.363261).abs() < 1e-4);
        assert!((st.sample.truth_lon.unwrap_or(0.0) - 149.16523).abs() < 1e-4);
        assert_eq!(st.sample.live_nums.get("ATTITUDE.roll"), Some(&0.5));
        assert!(st.sample.live_nums.contains_key("ATTITUDE.rollspeed"));
    }

    #[test]
    fn the_buffer_summarizes_the_window_and_names_a_gap() {
        let now = wall_time();
        let names = vec![
            "DISTANCE_SENSOR.current_distance".to_string(),
            "OPTICAL_FLOW.quality".to_string(),
            "NOT_A_LINE".to_string(),
        ];
        let value = with_live_cleared(|buf| {
            let mut old = Sample::empty();
            old.live_nums.insert("DISTANCE_SENSOR.current_distance".into(), 99.0);
            buf.push_at(&old, now - 120.0);
            let mut a = Sample::empty();
            a.live_nums.insert("DISTANCE_SENSOR.current_distance".into(), 1.0);
            buf.push_at(&a, now - 2.0);
            let mut b = Sample::empty();
            b.live_nums.insert("DISTANCE_SENSOR.current_distance".into(), 3.0);
            buf.push_at(&b, now - 1.0);
            buf.query(&names, 60.0)
        });
        assert_eq!(value["ok"], true);
        assert_eq!(value["samples"], 2);
        assert_eq!(value["lines"][0]["id"], "DISTANCE_SENSOR.current_distance");
        assert_eq!(value["lines"][0]["latest"], 3.0);
        assert_eq!(value["lines"][0]["min"], 1.0);
        assert_eq!(value["lines"][0]["max"], 3.0);
        assert_eq!(value["lines"][0]["mean"], 2.0);
        assert_eq!(value["lines"][0]["n"], 2);
        assert_eq!(value["lines"][0]["points"][1]["t"], 1.0);
        assert_eq!(value["absent"][0]["id"], "OPTICAL_FLOW.quality");
        assert_eq!(value["missing"][0], "NOT_A_LINE");
        assert!(value["lines"][0]["points"].as_array().unwrap().len() <= 24);
        assert!(value["note"].as_str().unwrap().contains("An empty unit is unknown."));
    }

    #[test]
    fn live_fields_marks_a_sample_that_arrived() {
        let now = wall_time();
        let value = with_live_cleared(|buf| {
            let mut sample = Sample::empty();
            sample.live_nums.insert("DISTANCE_SENSOR.current_distance".into(), 1.5);
            sample.live_nums.insert("NAMED_VALUE_FLOAT.TUT_TICK".into(), 3.5);
            buf.push_at(&sample, now);
            buf.catalog()
        });
        let fields = value["fields"].as_object().unwrap();
        let rng = fields.get("DISTANCE_SENSOR.current_distance").unwrap();
        assert!(fields.get("OPTICAL_FLOW.quality").is_none());
        assert_eq!(rng, &serde_json::json!({}));
        assert_eq!(fields["NAMED_VALUE_FLOAT.TUT_TICK"]["l"], "TUT_TICK");
        assert!(rng.get("l").is_none());
        assert!(rng.get("u").is_none());
        assert!(rng.get("p").is_none());
        assert!(value["note"].as_str().unwrap().contains("An empty unit is unknown."));
    }

    #[test]
    fn a_named_float_keeps_the_script_name() {
        let mut st = LinkState::new();
        let hdr = MavHeader { system_id: 1, component_id: 1, sequence: 0 };
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::NAMED_VALUE_FLOAT(mavlink::ardupilotmega::NAMED_VALUE_FLOAT_DATA {
                time_boot_ms: 10,
                value: 3.5,
                name: name10("TUT_TICK"),
            }),
        );
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::NAMED_VALUE_FLOAT(mavlink::ardupilotmega::NAMED_VALUE_FLOAT_DATA {
                time_boot_ms: 20,
                value: 9.0,
                name: name10("OTHER"),
            }),
        );
        assert_eq!(st.sample.live_nums.get("NAMED_VALUE_FLOAT.TUT_TICK"), Some(&3.5));
        assert_eq!(st.sample.live_nums.get("NAMED_VALUE_FLOAT.OTHER"), Some(&9.0));
        assert!(!st.sample.live_nums.contains_key("NAMED_VALUE_FLOAT.value"));
        assert!(!st.sample.live_nums.contains_key("NAMED_VALUE_FLOAT.time_boot_ms"));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::NAMED_VALUE_INT(mavlink::ardupilotmega::NAMED_VALUE_INT_DATA {
                time_boot_ms: 30,
                value: 4,
                name: name10("TUT_N"),
            }),
        );
        assert_eq!(st.sample.live_nums.get("NAMED_VALUE_INT.TUT_N"), Some(&4.0));
        handle_msg(
            &mut st,
            &hdr,
            MavMessage::NAMED_VALUE_FLOAT(mavlink::ardupilotmega::NAMED_VALUE_FLOAT_DATA {
                value: 1.0,
                name: name10("bad name"),
                ..Default::default()
            }),
        );
        assert!(!st.sample.live_nums.keys().any(|key| key.contains("bad")));
        assert!(!st.sample.live_nums.contains_key("NAMED_VALUE_FLOAT.value"));
        let (id, label, _) = live_meta("NAMED_VALUE_FLOAT.TUT_TICK").unwrap();
        assert_eq!(id, "NAMED_VALUE_FLOAT.TUT_TICK");
        assert_eq!(label, "TUT_TICK");
    }

    fn name10(text: &str) -> [u8; 10] {
        let mut name = [0u8; 10];
        let bytes = text.as_bytes();
        let n = bytes.len().min(10);
        name[..n].copy_from_slice(&bytes[..n]);
        name
    }
}

#[cfg(test)]
mod mag_cal_tests {
    use super::{note_mag_progress, note_mag_report, Sample};

    #[test]
    fn progress_and_report_share_one_slot_per_compass() {
        let mut sample = Sample::empty();
        note_mag_progress(&mut sample, 0, 2, 1, 40, [0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        note_mag_progress(&mut sample, 1, 2, 1, 15, [0; 10]);
        note_mag_progress(&mut sample, 0, 3, 1, 70, [0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        note_mag_report(
            &mut sample,
            0,
            4,
            1,
            12.5,
            [1.0, 2.0, 3.0],
            [1.1, 0.9, 1.0],
            [0.01, -0.02, 0.0],
        );
        assert_eq!(sample.mag_cal.len(), 2);
        assert_eq!(sample.mag_cal[0].id, 0);
        assert_eq!(sample.mag_cal[0].status, 4);
        assert_eq!(sample.mag_cal[0].pct, 100);
        assert_eq!(sample.mag_cal[0].mask[0], 0x0f);
        assert_eq!(sample.mag_cal[0].fitness, Some(12.5));
        assert_eq!(sample.mag_cal[0].autosaved, Some(1));
        assert_eq!(sample.mag_cal[1].pct, 15);
        assert!(sample.mag_cal[1].fitness.is_none());
    }
}

#[cfg(test)]
mod accel_cal_tests {
    use super::{note_accel_pos, Sample};

    #[test]
    fn only_known_faces_are_stored() {
        let mut sample = Sample::empty();
        note_accel_pos(&mut sample, 2, 10.0);
        assert_eq!(sample.accel_cal.pos, 2);
        note_accel_pos(&mut sample, 99, 11.0);
        assert_eq!(sample.accel_cal.pos, 2);
        note_accel_pos(&mut sample, 16_777_215, 12.0);
        assert_eq!(sample.accel_cal.pos, 16_777_215);
        assert_eq!(sample.accel_cal.at, 12.0);
    }
}

#[cfg(test)]
mod storage_wipe_tests {
    use super::storage_wipe_reason;

    #[test]
    fn format_version_and_flash_erase_bit_are_refused() {
        assert!(storage_wipe_reason("FORMAT_VERSION", 0.0).is_some());
        assert!(storage_wipe_reason("format_version", 120.0).is_some());
        assert!(storage_wipe_reason("BRD_OPTIONS", 16.0).is_some());
        assert!(storage_wipe_reason("BRD_OPTIONS", 17.0).is_some());
        assert!(storage_wipe_reason("BRD_OPTIONS", 1.0).is_none());
        assert!(storage_wipe_reason("FRAME_CLASS", 1.0).is_none());
    }
}

#[cfg(test)]
mod connect_fill_tests {
    use super::PRIORITY_PARAMS;
    use std::collections::HashSet;

    #[test]
    fn live_screen_params_are_named_once() {
        let mut seen = HashSet::new();
        for name in PRIORITY_PARAMS {
            assert!(seen.insert(*name), "{name}");
        }
        assert!(seen.contains("SCR_ENABLE"));
        assert!(seen.contains("ATC_RAT_RLL_P"));
    }
}

#[cfg(test)]
mod param_file_tests {
    use super::parse_param_file;

    #[test]
    fn reads_mission_planner_lines_and_keeps_the_last_duplicate() {
        let parsed = parse_param_file(
            "# ArduLoops\nACRO_BAL_PITCH,1.5\n\nATC_RAT_RLL_P 0.135 # note\nACRO_BAL_PITCH,2\n",
        )
        .unwrap();
        assert_eq!(parsed, vec![
            ("ACRO_BAL_PITCH".into(), 2.0),
            ("ATC_RAT_RLL_P".into(), 0.135),
        ]);
    }

    #[test]
    fn rejects_a_file_with_no_parameters() {
        assert_eq!(
            parse_param_file("# only a comment\n").unwrap_err(),
            "No parameters in this file"
        );
        assert!(parse_param_file("NOT A PARAM LINE").is_err());
    }
}

#[cfg(test)]
mod reboot_wait {
    use super::{reboot_gap, reboot_heartbeat, reboot_started, rebooting, wall_time};

    #[test]
    fn a_reboot_ends_on_a_heartbeat_after_the_gap() {
        reboot_started();
        assert!(rebooting());
        // Heartbeats before the link goes quiet are the old boot.
        reboot_heartbeat(wall_time() + 10.0);
        assert!(rebooting());
        reboot_gap();
        reboot_heartbeat(wall_time() - 1.0);
        assert!(rebooting());
        reboot_heartbeat(wall_time() + 1.0);
        assert!(!rebooting());
    }
}

#[cfg(test)]
mod param_file {
    use super::{parse_param_pack, ParamPack, PCK_MAGIC, PCK_MAGIC_DEFAULTS};

    /// Packs like AP_Filesystem_Param::pack_param, with pad bytes so no value crosses a read.
    fn pack(params: &[(&str, u8, f64)], defaults: bool, read_size: usize) -> Vec<u8> {
        let magic = if defaults { PCK_MAGIC_DEFAULTS } else { PCK_MAGIC };
        let mut out = Vec::new();
        out.extend_from_slice(&magic.to_le_bytes());
        out.extend_from_slice(&(params.len() as u16).to_le_bytes());
        out.extend_from_slice(&(params.len() as u16 + 3).to_le_bytes());
        let mut last = String::new();
        for (name, kind, value) in params {
            let mut common = name.bytes().zip(last.bytes()).take_while(|(a, b)| a == b).count().min(15);
            if common == name.len() {
                common -= 1;
            }
            let rest = &name[common..];
            let raw: Vec<u8> = match kind {
                1 => vec![*value as i8 as u8],
                2 => (*value as i16).to_le_bytes().to_vec(),
                3 => (*value as i32).to_le_bytes().to_vec(),
                _ => (*value as f32).to_le_bytes().to_vec(),
            };
            let with_default = defaults && *kind == 4;
            let len = raw.len() + rest.len() + 2 + if with_default { raw.len() } else { 0 };
            let m = (out.len() + len) % read_size;
            if raw.len() > 1 && m > 0 && m < raw.len() {
                out.extend(std::iter::repeat(0).take(raw.len() - m));
            }
            out.push(kind | if with_default { 1 << 4 } else { 0 });
            out.push(common as u8 | ((rest.len() as u8 - 1) << 4));
            out.extend_from_slice(rest.as_bytes());
            out.extend_from_slice(&raw);
            if with_default {
                out.extend_from_slice(&raw);
            }
            last = name.to_string();
        }
        out
    }

    #[test]
    fn a_packed_file_gives_every_value_in_index_order() {
        let params = [
            ("ATC_RAT_RLL_D", 4, 0.0036),
            ("ATC_RAT_RLL_I", 4, 0.135),
            ("ATC_RAT_RLL_P", 4, 0.135),
            ("FRAME_CLASS", 1, 1.0),
            ("FRAME_TYPE", 1, 1.0),
            ("SERVO1_FUNCTION", 2, 33.0),
            ("SERVO1_MAX", 2, 1900.0),
            ("SYSID_THISMAV", 2, 1.0),
            ("LOG_BITMASK", 3, 176126.0),
            ("TRIM_THROTTLE", 1, -5.0),
        ];
        for read_size in [7usize, 16, 239] {
            for defaults in [false, true] {
                let ParamPack { total, values } = parse_param_pack(&pack(&params, defaults, read_size)).unwrap();
                assert_eq!(total, params.len() as u16 + 3);
                assert_eq!(values.len(), params.len());
                for ((name, value), (want, _, want_value)) in values.iter().zip(params.iter()) {
                    assert_eq!(name, want);
                    assert!((value - want_value).abs() < 1e-6, "{name}: {value} != {want_value}");
                }
            }
        }
    }

    #[test]
    fn a_short_or_foreign_file_is_not_trusted() {
        assert!(parse_param_pack(&[0x1b, 0x67]).is_err());
        assert!(parse_param_pack(&[1, 2, 0, 0, 0, 0]).is_err());
        let full = pack(&[("A_ONE", 4, 1.0), ("A_TWO", 4, 2.0)], false, 239);
        // A cut file keeps what arrived whole; the by-index path fills the rest.
        let cut = parse_param_pack(&full[..full.len() - 2]).unwrap();
        assert_eq!(cut.values, vec![("A_ONE".to_string(), 1.0)]);
    }
}

/// Live check against a running SITL: `PCK_URL=tcpout:127.0.0.1:5790 cargo test --lib param_file_live -- --ignored --nocapture`.
/// Downloads every parameter as one file, then again one index at a time, and compares.
#[cfg(test)]
mod param_file_live {
    use super::*;

    fn link(url: &str) -> (Box<dyn MavConnection<MavMessage> + Send + Sync>, LinkState) {
        let conn = open_conn(url).ok().expect("connect");
        let mut st = LinkState::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if let Ok((hdr, msg)) = conn.recv() {
                let hb = matches!(msg, MavMessage::HEARTBEAT(_)) && hdr.component_id == 1;
                handle_msg(&mut st, &hdr, msg);
                if hb {
                    st.target_system = hdr.system_id;
                    st.target_component = hdr.component_id;
                    return (conn, st);
                }
            }
        }
        panic!("no heartbeat");
    }

    fn complete(st: &LinkState) -> bool {
        st.sample.param_count > 0 && st.sample.param_indices.len() >= st.sample.param_count as usize
    }

    #[test]
    #[ignore]
    fn param_file_live() {
        let url = std::env::var("PCK_URL").unwrap_or_else(|_| "tcpout:127.0.0.1:5790".into());
        let on_sample: OnSample = Arc::new(|_| {});
        let latest = Mutex::new(Sample::empty());
        let sitl = crate::sitl::SitlCtl::new();

        let (conn, mut st) = link(&url);
        let started = Instant::now();
        let budget = std::env::var("PCK_BUDGET_MS").ok().and_then(|v| v.parse().ok()).map(Duration::from_millis).unwrap_or(PARAM_FILE_BUDGET);
        let (n, singles) = download_param_file(&*conn, &mut st, &on_sample, &latest, &sitl, budget).expect("param file");
        let file_ms = started.elapsed().as_millis();
        println!("file: {n} of {} params in {file_ms} ms, {singles} single reads, complete={}", st.sample.param_count, complete(&st));
        if std::env::var("PCK_BUDGET_MS").is_ok() {
            // A cut download keeps its first values; the by-index path fills the rest on the same link.
            assert!(n > 0 && !complete(&st));
            let started = Instant::now();
            while !complete(&st) && started.elapsed() < Duration::from_secs(180) {
                fill_missing_params(&*conn, &mut st, Instant::now(), true);
                if let Ok((hdr, msg)) = conn.recv() {
                    handle_msg(&mut st, &hdr, msg);
                }
            }
            println!("rest by index: {} of {} in {} ms", st.sample.param_indices.len(), st.sample.param_count, started.elapsed().as_millis());
            assert!(complete(&st));
            return;
        }
        assert!(complete(&st));
        let by_file = st.sample.params.clone();
        if std::env::var("PCK_COMPARE").is_err() {
            return;
        }

        // SITL takes one TCP client, so the same link starts over with nothing known.
        let (target_system, target_component) = (st.target_system, st.target_component);
        let mut st = LinkState::new();
        st.target_system = target_system;
        st.target_component = target_component;
        st.sample.heartbeat_at = wall_time();
        let started = Instant::now();
        while !complete(&st) && started.elapsed() < Duration::from_secs(180) {
            fill_missing_params(&*conn, &mut st, Instant::now(), true);
            if let Ok((hdr, msg)) = conn.recv() {
                handle_msg(&mut st, &hdr, msg);
            }
        }
        let index_ms = started.elapsed().as_millis();
        println!("by index: {} of {} params in {index_ms} ms", st.sample.param_indices.len(), st.sample.param_count);
        assert!(complete(&st));

        // These change on their own after boot. The by-index path also reads a few names that
        // the list hides (SCR_HEAP_SIZE while scripting is off).
        let moves = |name: &str| {
            name.starts_with("STAT_") || name.ends_with("_GND_PRESS") || name == "COMPASS_DEC" || name == "MIS_TOTAL"
        };
        let mut differ = Vec::new();
        for (name, value) in &st.sample.params {
            if moves(name) || PRIORITY_PARAMS.contains(&name.as_str()) && !by_file.contains_key(name) {
                continue;
            }
            match by_file.get(name) {
                Some(v) if (*v as f32) == (*value as f32) => {}
                other => differ.push(format!("{name}: index {value} file {other:?}")),
            }
        }
        println!("values that differ: {}", differ.len());
        for line in differ.iter().take(10) {
            println!("  {line}");
        }
        assert!(differ.is_empty());
    }
}

#[cfg(test)]
mod param_file_pieces {
    use super::Burst;

    #[test]
    fn pieces_join_up_to_the_first_gap() {
        let mut file = Burst::default();
        file.pieces.insert(0, vec![1, 2, 3]);
        file.pieces.insert(6, vec![7, 8]);
        assert_eq!(file.first_gap(), 3);
        assert_eq!(file.bytes(), vec![1, 2, 3]);
        // A restarted burst overlaps what arrived; the gap closes and the rest joins on.
        file.pieces.insert(2, vec![3, 4, 5, 6]);
        assert_eq!(file.first_gap(), 8);
        assert_eq!(file.bytes(), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }
}

/// The whole connection loop against a running SITL:
/// `PCK_URL=tcpout:127.0.0.1:5790 cargo test --lib param_file_session_live -- --ignored --nocapture`.
#[cfg(test)]
mod param_file_session_live {
    use super::*;

    #[test]
    #[ignore]
    fn param_file_session_live() {
        let url = std::env::var("PCK_URL").unwrap_or_else(|_| "tcpout:127.0.0.1:5790".into());
        let (tx, rx) = std::sync::mpsc::channel::<Cmd>();
        let seen: Arc<Mutex<Vec<(Instant, Sample)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let on_sample: OnSample = Arc::new(move |s: &Sample| {
            if let Ok(mut g) = sink.lock() {
                g.push((Instant::now(), s.clone()));
            }
        });
        let latest = Arc::new(Mutex::new(Sample::empty()));
        let started = Instant::now();
        let link_url = Arc::new(Mutex::new(url));
        std::thread::spawn(move || run_loop(on_sample, rx, latest, link_url, crate::sitl::SitlCtl::new()));

        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let g = seen.lock().unwrap();
            if let Some((t, s)) = g.last() {
                if t.duration_since(started).as_secs() % 10 == 0 && t.elapsed() < Duration::from_millis(150) {
                    println!("{} s: ok={} {} of {} params, file \"{}\", att_hz {}, {}", t.duration_since(started).as_secs(), s.ok, s.params.len(), s.param_count, s.param_file, s.att_hz, s.detail);
                }
            }
            assert!(Instant::now() < deadline, "parameters did not complete");
            if let Some((_, s)) = g.last() {
                if s.ok && s.param_count > 0 && s.params.len() >= s.param_count as usize {
                    break;
                }
            }
        }
        drop(tx);
        let g = seen.lock().unwrap();
        let at = |pick: &dyn Fn(&Sample) -> bool| g.iter().find(|(_, s)| pick(s)).map(|(t, _)| t.duration_since(started).as_millis());
        let linked = at(&|s| s.ok);
        let attitude = at(&|s| s.att_hz > 0);
        let file = at(&|s| !s.param_file.is_empty());
        let done = at(&|s| s.param_count > 0 && s.params.len() >= s.param_count as usize);
        let (_, last) = g.last().unwrap();
        // The longest stretch with no new attitude while linked: what the download costs the live view.
        let mut pause = 0u128;
        let mut prev: Option<(Instant, f64)> = None;
        for (t, s) in g.iter().filter(|(_, s)| s.ok) {
            if let Some((pt, proll)) = prev {
                if s.roll != proll {
                    pause = pause.max(t.duration_since(pt).as_millis());
                    prev = Some((*t, s.roll));
                }
            } else {
                prev = Some((*t, s.roll));
            }
        }
        println!(
            "linked {linked:?} ms, attitude {attitude:?} ms, file \"{}\" at {file:?} ms, complete {done:?} ms ({} params), longest attitude pause {pause} ms",
            last.param_file,
            last.params.len()
        );
        // Parameter counts the page saw on the way, as the link chip's bar would show them.
        let mut steps: Vec<usize> = Vec::new();
        for (_, s) in g.iter() {
            let n = s.params.len();
            if s.ok && n > 0 && steps.last() != Some(&n) {
                steps.push(n);
            }
        }
        println!("parameter counts on the way: {steps:?}");
        let hz: Vec<u32> = g.iter().filter(|(_, s)| s.ok).map(|(_, s)| s.att_hz).collect();
        println!("att_hz from {} to {}", hz.iter().min().unwrap_or(&0), hz.iter().max().unwrap_or(&0));
        assert!(last.param_file.contains(" in "), "file download did not run: {}", last.param_file);
    }
}
