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
