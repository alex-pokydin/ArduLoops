// Tests.


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_float_in_a_log_row_rounds_to_four_places() {
        let ugly = round_logged(&json!(0.1f32));
        assert_eq!(ugly.to_string(), "0.1", "{ugly}");
        assert_eq!(round_logged(&json!(1.23456789_f64)).to_string(), "1.2346");
        assert_eq!(round_logged(&json!(1_500_000_u64)), json!(1_500_000));
        assert_eq!(round_logged(&json!(-0.30000004_f64)).to_string(), "-0.3");
    }

    #[test]
    fn a_stored_name_carries_the_content_hash() {
        let id = "002F00354D53501220303932/5262f54c6046823c_20260930090738_1.bin";
        let parts = stored_name_parts(id);
        assert_eq!(parts["sha256_16"], json!("5262f54c6046823c"));
        assert_eq!(parts["flight_stamp"], json!("20260930090738"));
        assert_eq!(parts["vehicle"], json!("002F00354D53501220303932"));
        assert!(parts.get("onboard_id").is_none());
        let older = stored_name_parts("5262f54c6046823c-3.bin");
        assert_eq!(older["sha256_16"], json!("5262f54c6046823c"));
        assert!(stored_name_parts("log-3.bin").get("sha256_16").is_none());
    }

    fn push_fmt(buf: &mut Vec<u8>, type_id: u8, name: &str, format: &str, labels: &str) {
        let width: usize = format.chars().map(|c| field_size(c).unwrap()).sum();
        buf.extend_from_slice(&[HEAD1, HEAD2, FMT_TYPE, type_id, (width + 3) as u8]);
        let mut name_b = [0u8; 4];
        name_b[..name.len()].copy_from_slice(name.as_bytes());
        buf.extend_from_slice(&name_b);
        let mut fmt_b = [0u8; 16];
        fmt_b[..format.len()].copy_from_slice(format.as_bytes());
        buf.extend_from_slice(&fmt_b);
        let mut lab = [0u8; 64];
        lab[..labels.len()].copy_from_slice(labels.as_bytes());
        buf.extend_from_slice(&lab);
    }

    fn push_dsf(buf: &mut Vec<u8>, type_id: u8, time: u64, dp: u32, fmn: u32) {
        buf.extend_from_slice(&[HEAD1, HEAD2, type_id]);
        buf.extend_from_slice(&time.to_le_bytes());
        buf.extend_from_slice(&dp.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&100u32.to_le_bytes());
        buf.extend_from_slice(&fmn.to_le_bytes());
        buf.extend_from_slice(&800u32.to_le_bytes());
        buf.extend_from_slice(&400u32.to_le_bytes());
    }

    #[test]
    fn dsf_reports_the_rejected_write_increase_and_the_tightest_buffer() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 170, "DSF", "QIHIIII", "TimeUS,Dp,Blk,Bytes,FMn,FMx,FAv");
        push_dsf(&mut buf, 170, 1_000_000, 2, 500);
        push_dsf(&mut buf, 170, 2_000_000, 5, 40);
        let logging = logging_of(&buf);
        assert_eq!(logging["rows"], json!(2));
        assert_eq!(logging["dp_first"], json!(2));
        assert_eq!(logging["dp_last"], json!(5));
        assert_eq!(logging["dp_increase"], json!(3));
        assert_eq!(logging["fmn_min"], json!(40));
        let note = logging["note"].as_str().unwrap();
        assert!(note.contains("It does not name which message was rejected."));
        assert!(note.contains("It does not say the storage failed."));
        assert!(!note.contains("LOG_FILE_BUFSIZE"));
    }

    #[test]
    fn a_missing_dsf_message_is_unknown_not_zero_drops() {
        let logging = logging_of(&[]);
        assert_eq!(logging["rows"], json!(0));
        assert!(logging.get("dp_increase").is_none());
        let note = logging["note"].as_str().unwrap();
        assert!(note.contains("Rejected writes are unknown."));
        assert!(note.contains("That is not a count of zero."));
    }

    #[test]
    fn a_falling_dp_counter_has_no_increase() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 170, "DSF", "QIHIIII", "TimeUS,Dp,Blk,Bytes,FMn,FMx,FAv");
        push_dsf(&mut buf, 170, 1_000_000, 5, 100);
        push_dsf(&mut buf, 170, 2_000_000, 1, 100);
        let logging = logging_of(&buf);
        assert_eq!(logging["dp_first"], json!(5));
        assert_eq!(logging["dp_last"], json!(1));
        assert!(logging["dp_increase"].is_null());
        assert!(logging["note"].as_str().unwrap().contains("the counter fell"));
    }

    #[test]
    fn decodes_fmt_and_a_sample() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qf", "TimeUS,P");
        buf.extend_from_slice(&[HEAD1, HEAD2, 129]);
        buf.extend_from_slice(&1_000_000u64.to_le_bytes());
        buf.extend_from_slice(&0.25f32.to_le_bytes());
        let formats = parse_formats(&buf);
        assert_eq!(formats[&129].name, "RATE");
        let mut rows = Vec::new();
        let mut incomplete = false;
        walk(&buf, &formats, |fmt, _, values| {
            if fmt.name == "RATE" {
                rows.push(values.to_vec());
            }
        }, &mut incomplete);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0][0].as_u64(), Some(1_000_000));
        assert!((rows[0][1].as_f64().unwrap() - 0.25).abs() < 1e-6);
    }

    fn push_qz(buf: &mut Vec<u8>, type_id: u8, time: u64, text: &str) {
        buf.extend_from_slice(&[HEAD1, HEAD2, type_id]);
        buf.extend_from_slice(&time.to_le_bytes());
        let mut msg = [0u8; 64];
        msg[..text.len()].copy_from_slice(text.as_bytes());
        buf.extend_from_slice(&msg);
    }

    #[test]
    fn summarizes_firmware_frame_and_duration_from_head_and_tail() {
        let mut head = Vec::new();
        push_fmt(&mut head, 160, "MSG", "QZ", "TimeUS,Message");
        push_fmt(&mut head, 161, "GPS", "QBIH", "TimeUS,Status,GMS,GWk");
        push_qz(&mut head, 160, 1_000_000, "ArduCopter V4.7.1 (dbe79216)");
        push_qz(&mut head, 160, 2_000_000, "Frame: QUAD/X");
        head.extend_from_slice(&[HEAD1, HEAD2, 161]);
        head.extend_from_slice(&3_000_000u64.to_le_bytes());
        head.push(3);
        head.extend_from_slice(&0u32.to_le_bytes());
        head.extend_from_slice(&2380u16.to_le_bytes());
        let mut tail = Vec::new();
        push_qz(&mut tail, 160, 61_000_000, "Disarmed");
        let summary = summarize_log(&head, &tail);
        assert_eq!(summary.firmware, "ArduCopter V4.7.1 (dbe79216)");
        assert_eq!(summary.frame, "QUAD/X");
        assert_eq!(summary.duration_us, 60_000_000);
        assert!(summary.start_utc.ends_with('Z'), "{}", summary.start_utc);
        push_qz(&mut head, 160, u64::MAX, "not a time");
        let bounded = summarize_log(&head, &tail);
        assert_eq!(bounded.duration_us, 60_000_000, "a TimeUS of u64::MAX is not a longer flight");
    }

    #[test]
    fn fft_finds_a_known_tone() {
        let mut samples = Vec::new();
        let rate = 100.0;
        for i in 0..256 {
            let t = i as f64 / rate;
            let y = (2.0 * std::f64::consts::PI * 10.0 * t).sin();
            samples.push(((i as f64 * 1_000_000.0 / rate) as u64, y));
        }
        let out = fft_peak(&samples, false);
        let hz = out["peak_hz"].as_f64().unwrap();
        assert!((hz - 10.0).abs() < 1.0, "{out}");
    }

    #[test]
    fn gyro_batch_peak_ignores_aircraft_motion() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 248, "ISBH", "QHBBHHQf", "TimeUS,N,type,instance,mul,smp_cnt,SampleUS,smp_rate");
        push_fmt(&mut buf, 249, "ISBD", "QHHaaa", "TimeUS,N,seqno,x,y,z");
        let mul = 100.0;
        let rate = 1000.0_f32;
        let count = 256u16;
        let mut head = Vec::new();
        head.extend_from_slice(&0u64.to_le_bytes());
        head.extend_from_slice(&1u16.to_le_bytes());
        head.push(1);
        head.push(0);
        head.extend_from_slice(&100u16.to_le_bytes());
        head.extend_from_slice(&count.to_le_bytes());
        head.extend_from_slice(&0u64.to_le_bytes());
        head.extend_from_slice(&rate.to_le_bytes());
        buf.extend_from_slice(&[HEAD1, HEAD2, 248]);
        buf.extend_from_slice(&head);
        for seq in 0..8u16 {
            let mut body = Vec::new();
            body.extend_from_slice(&0u64.to_le_bytes());
            body.extend_from_slice(&1u16.to_le_bytes());
            body.extend_from_slice(&seq.to_le_bytes());
            for axis in 0..3 {
                for k in 0..32u16 {
                    let i = seq as f64 * 32.0 + k as f64;
                    let t = i / 1000.0;
                    let sample = if axis == 0 {
                        5.0 * (2.0 * std::f64::consts::PI * t).sin()
                            + 0.4 * (2.0 * std::f64::consts::PI * 80.0 * t).sin()
                            + 0.2 * (2.0 * std::f64::consts::PI * 160.0 * t).sin()
                    } else {
                        0.0
                    };
                    body.extend_from_slice(&((sample * mul).round() as i16).to_le_bytes());
                }
            }
            buf.extend_from_slice(&[HEAD1, HEAD2, 249]);
            buf.extend_from_slice(&body);
        }
        let out = gyro_batch_fft_bytes(&buf);
        let hz = out["axes"][0]["peak_hz"].as_f64().unwrap();
        assert!((hz - 80.0).abs() < 2.0, "{out}");
        let second = out["harmonics"].as_array().unwrap().iter().find(|row| row["n"].as_u64() == Some(2)).unwrap();
        let db = second["db"].as_f64().unwrap();
        assert!((db + 6.0).abs() < 6.0, "{out}");
        assert_eq!(out["spectrum"].as_array().unwrap().len(), 32);
        let column = &out["spectrogram"]["columns"][0];
        assert!((column["hz"].as_f64().unwrap() - 80.0).abs() < 2.0, "{out}");
    }

    #[test]
    fn downloaded_copter_batch_peak_is_in_the_motor_band() {
        let out = gyro_batch_fft("002F00354D53501220303932/log-00003.bin");
        let error = out["error"].as_str().unwrap_or("");
        if error.contains("log not found") || error.contains("not in local storage") {
            return;
        }
        assert_eq!(out["ok"], json!(true), "{out}");
        let hz = out["peak_hz"].as_f64().unwrap();
        assert!(hz >= 20.0, "{out}");
        let spec = &out["spectrogram"];
        assert!(spec["columns"].as_array().unwrap().len() > 1, "{spec}");
        assert!(spec["hz_min"].as_f64().unwrap() <= spec["hz_max"].as_f64().unwrap());
    }

    fn rate_row(buf: &mut Vec<u8>, us: u64, desired: f32, actual: f32) {
        buf.extend_from_slice(&[HEAD1, HEAD2, 129]);
        buf.extend_from_slice(&us.to_le_bytes());
        buf.extend_from_slice(&desired.to_le_bytes());
        buf.extend_from_slice(&actual.to_le_bytes());
    }

    #[test]
    fn track_pairs_the_overshoot_with_that_command() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        rate_row(&mut buf, 0, 0.0, 0.0);
        rate_row(&mut buf, 100_000, 50.0, 40.0);
        rate_row(&mut buf, 200_000, 100.0, 90.0);
        rate_row(&mut buf, 300_000, 100.0, 130.0);
        rate_row(&mut buf, 400_000, 20.0, 80.0);
        rate_row(&mut buf, 500_000, 0.0, 25.0);
        rate_row(&mut buf, 1_200_000, 0.0, -180.0);
        let out = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(out["actual"], json!("R"));
        assert_eq!(out["desired"], json!("RDes"));
        assert_eq!(out["past_command"]["desired"], json!(100.0));
        assert_eq!(out["past_command"]["actual"], json!(130.0));
        assert_eq!(out["past_command"]["excess"], json!(30.0));
        assert_eq!(out["release"]["actual"], json!(80.0));
        assert_eq!(out["release"]["command"], json!(100.0));
        assert_eq!(out["release"]["delay_s"], json!(0.1));
        assert_eq!(out["release"]["crossings"], json!(0));
        assert_eq!(out["max_abs_desired"], json!(100.0));
        assert_eq!(out["active_count"], json!(3));
        assert_eq!(out["active_error_rms"], json!(19.1));
        assert_eq!(out["peak_error"]["actual"], json!(-180.0));
        assert_eq!(out["peak_error"]["opposite_sign"], json!(false));
        assert!(out["step"].is_null(), "{out}");
        let missing = track_bytes(&buf, "RATE", "Y", None, None);
        assert!(missing["error"].as_str().unwrap().contains("actual column"));
    }

    #[test]
    fn a_small_tracking_error_is_not_rounded_to_zero() {
        assert_eq!(super::round_meas(0.034), 0.034);
        assert_eq!(super::round_meas(19.14), 19.1);
    }

    fn sample_row(buf: &mut Vec<u8>, type_id: u8, us: u64, values: &[f32]) {
        buf.extend_from_slice(&[HEAD1, HEAD2, type_id]);
        buf.extend_from_slice(&us.to_le_bytes());
        for value in values {
            buf.extend_from_slice(&value.to_le_bytes());
        }
    }

    #[test]
    fn track_pairs_angle_height_and_the_shaped_target() {
        let mut attitude = Vec::new();
        push_fmt(&mut attitude, 129, "ATT", "Qff", "TimeUS,DesRoll,Roll");
        sample_row(&mut attitude, 129, 0, &[10.0, 8.0]);
        let roll = track_bytes(&attitude, "ATT", "Roll", None, None);
        assert_eq!(roll["actual"], json!("Roll"));
        assert_eq!(roll["desired"], json!("DesRoll"));
        let from_desired = track_bytes(&attitude, "ATT", "DesRoll", None, None);
        assert_eq!(from_desired["actual"], json!("Roll"));

        let mut down = Vec::new();
        push_fmt(&mut down, 130, "PSCD", "Qffffff", "TimeUS,DPD,TPD,PD,DVD,TVD,VD");
        sample_row(&mut down, 130, 0, &[-1.0, -1.2, -1.1, 0.2, 0.3, 0.25]);
        let position = track_bytes(&down, "PSCD", "PD", None, None);
        assert_eq!(position["desired"], json!("TPD"));
        let velocity = track_bytes(&down, "PSCD", "VD", None, None);
        assert_eq!(velocity["desired"], json!("TVD"));

        let mut climb = Vec::new();
        push_fmt(&mut climb, 131, "CTUN", "Qfff", "TimeUS,DAlt,Alt,TAlt");
        sample_row(&mut climb, 131, 0, &[20.0, 19.0, 18.0]);
        let altitude = track_bytes(&climb, "CTUN", "Alt", None, None);
        assert_eq!(altitude["desired"], json!("DAlt"));

        let mut tecs = Vec::new();
        push_fmt(&mut tecs, 132, "TECS", "Qff", "TimeUS,h,hdem");
        sample_row(&mut tecs, 132, 0, &[100.0, 110.0]);
        let height = track_bytes(&tecs, "TECS", "h", None, None);
        assert_eq!(height["actual"], json!("h"));
        assert_eq!(height["desired"], json!("hdem"));

        let mut pid = Vec::new();
        push_fmt(&mut pid, 133, "PIDR", "Qffff", "TimeUS,Tar,Act,FF,DFF");
        sample_row(&mut pid, 133, 0, &[1.0, 1.1, 0.2, 0.3]);
        let feedforward = track_bytes(&pid, "PIDR", "FF", None, None);
        assert!(feedforward["error"].as_str().unwrap().contains("actual column"));
        let act = track_bytes(&pid, "PIDR", "Act", None, None);
        assert_eq!(act["desired"], json!("Tar"));
    }

    #[test]
    fn track_uses_the_short_arc_on_a_heading() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "ANG", "Qff", "TimeUS,DesYaw,Yaw");
        sample_row(&mut buf, 129, 0, &[10.0, 11.0]);
        sample_row(&mut buf, 129, 100_000, &[0.1, 359.5]);
        sample_row(&mut buf, 129, 200_000, &[10.0, 12.0]);
        let out = track_bytes(&buf, "ANG", "Yaw", None, None);
        assert_eq!(out["circular"], json!(true));
        assert_eq!(out["wrapped_samples"], json!(1));
        assert!(out["error_rms"].as_f64().unwrap() < 2.0, "{out}");
        assert!(out["peak_error"]["error"].as_f64().unwrap().abs() <= 2.0, "{out}");

        let mut rate = Vec::new();
        push_fmt(&mut rate, 130, "RATE", "Qfff", "TimeUS,RDes,R,P");
        sample_row(&mut rate, 130, 0, &[0.0, 0.0, 40.0]);
        sample_row(&mut rate, 130, 100_000, &[100.0, 140.0, 55.0]);
        let roll = track_bytes(&rate, "RATE", "R", None, None);
        assert_eq!(roll["circular"], json!(false));
        assert!(roll["past_command"]["excess"].as_f64().unwrap() > 0.0, "{roll}");
        assert!(roll["past_command"].get("p").is_none(), "{roll}");
    }

    #[test]
    fn step_on_the_search_edge_is_not_a_frequency() {
        let mut rows = Vec::new();
        for i in 0..20 {
            let desired = if i == 0 { 0.0 } else { 20.0 };
            rows.push(TrackRow { us: i * 20_000, desired, actual: desired, p: None, i: None, d: None, ff: None, dmod: None, output: None });
        }
        assert!(step_of(&rows).is_null());
    }

    #[test]
    fn track_keeps_the_d_term_on_that_row() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 130, "PIDR", "Qffffff", "TimeUS,Tar,Act,P,I,D,FF");
        for (us, tar, act, p, i, d, ff) in [
            (0u64, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.5f32, 0.0f32),
            (100_000, 50.0, 40.0, 0.01, 0.01, 0.01, 0.01),
            (200_000, 100.0, 90.0, 0.01, 0.01, 0.01, 0.01),
            (300_000, 100.0, 140.0, 0.11, 0.02, 0.22, 0.03),
            (400_000, 10.0, 30.0, 0.04, 0.04, 0.05, 0.04),
        ] {
            buf.extend_from_slice(&[HEAD1, HEAD2, 130]);
            buf.extend_from_slice(&us.to_le_bytes());
            buf.extend_from_slice(&tar.to_le_bytes());
            buf.extend_from_slice(&act.to_le_bytes());
            buf.extend_from_slice(&p.to_le_bytes());
            buf.extend_from_slice(&i.to_le_bytes());
            buf.extend_from_slice(&d.to_le_bytes());
            buf.extend_from_slice(&ff.to_le_bytes());
        }
        let out = track_bytes(&buf, "PIDR", "Act", None, None);
        assert_eq!(out["past_command"]["excess"], json!(40.0));
        assert_eq!(out["past_command"]["p"], json!(0.11));
        assert_eq!(out["past_command"]["i"], json!(0.02));
        assert_eq!(out["past_command"]["d"], json!(0.22));
        assert_eq!(out["past_command"]["ff"], json!(0.03));
        assert_eq!(out["release"]["d"], json!(0.05));
    }

    #[test]
    fn track_marks_a_sign_change_and_counts_crossings() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        for (us, desired, actual) in [
            (0u64, 0.0f32, 0.0f32),
            (100_000, 40.0, 5.0),
            (200_000, 100.0, -40.0),
            (300_000, 10.0, 30.0),
            (400_000, 0.0, -5.0),
            (500_000, 0.0, 8.0),
            (900_000, 0.0, 1.0),
        ] {
            rate_row(&mut buf, us, desired, actual);
        }
        let out = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(out["peak_error"]["desired"], json!(100.0));
        assert_eq!(out["peak_error"]["actual"], json!(-40.0));
        assert_eq!(out["peak_error"]["opposite_sign"], json!(true));
        assert_eq!(out["past_command"], json!(null));
        assert_eq!(out["sides"]["active_count"], json!(2), "{out}");
        assert_eq!(out["sides"]["beyond"]["count"], json!(0), "{out}");
        assert_eq!(out["sides"]["short"]["mean"], json!(35.0), "{out}");
        assert_eq!(out["sides"]["short"]["share"], json!(0.5), "{out}");
        assert_eq!(out["release"]["actual"], json!(30.0));
        assert_eq!(out["release"]["delay_s"], json!(null));
        assert_eq!(out["release"]["crossings"], json!(2));
        assert_eq!(out["active_count"], json!(2));
        assert_eq!(out["active_error_rms"], json!(102.0));
    }

    #[test]
    fn track_fits_a_held_command() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        let wn = 2.0 * std::f64::consts::PI * 5.0;
        for i in 0..40 {
            let t = i as f64 * 0.02;
            let desired = if i == 0 { 0.0 } else { 100.0 };
            let actual = if i == 0 { 0.0 } else { 100.0 * step_model(t - 0.02, 0.5, wn) };
            rate_row(&mut buf, (t * 1_000_000.0) as u64, desired, actual as f32);
        }
        let out = track_bytes(&buf, "RATE", "R", None, None);
        let zeta = out["step"]["zeta"].as_f64().expect(&out.to_string());
        let wn_hz = out["step"]["wn_hz"].as_f64().unwrap();
        assert!((zeta - 0.5).abs() < 0.2, "{out}");
        assert!((wn_hz - 5.0).abs() < 1.5, "{out}");
        assert_eq!(out["hold_count"], json!(1), "{out}");
        assert_eq!(out["holds"][0]["command"], json!(100.0), "{out}");
        assert_eq!(out["holds"][0]["from"], json!(0.0), "{out}");
        assert_eq!(out["holds"][0]["reached"], json!(true), "{out}");
        assert!(out["holds"][0]["zeta"].is_null(), "{out}");
    }

    #[test]
    fn holds_keep_each_settled_change() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        let mut us = 0u64;
        for _ in 0..8 {
            rate_row(&mut buf, us, 0.0, 0.0);
            us += 50_000;
        }
        for _ in 0..8 {
            rate_row(&mut buf, us, 10.0, 16.0);
            us += 50_000;
        }
        let over = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(over["hold_count"], json!(1), "{over}");
        assert_eq!(over["holds"][0]["from"], json!(0.0), "{over}");
        assert_eq!(over["holds"][0]["command"], json!(10.0), "{over}");
        assert_eq!(over["holds"][0]["overshoot"], json!(6.0), "{over}");
        assert_eq!(over["sides"]["beyond"]["mean"], json!(6.0), "{over}");
        assert_eq!(over["sides"]["beyond"]["share"], json!(1.0), "{over}");
        assert!(over["sides"]["short"]["mean"].is_null(), "{over}");
        assert_eq!(over["holds"][0]["reached"], json!(true), "{over}");
        assert!((over["holds"][0]["hold_s"].as_f64().unwrap() - 0.35).abs() < 0.001, "{over}");

        let mut flat = Vec::new();
        push_fmt(&mut flat, 129, "RATE", "Qff", "TimeUS,RDes,R");
        us = 0;
        for i in 0..30 {
            rate_row(&mut flat, us, i as f32, i as f32);
            us += 50_000;
        }
        let ramp = track_bytes(&flat, "RATE", "R", None, None);
        assert_eq!(ramp["hold_count"], json!(0), "{ramp}");
        assert!(ramp["holds"].as_array().unwrap().is_empty(), "{ramp}");
        assert_eq!(ramp["sides"]["beyond"]["count"], json!(0), "{ramp}");
        assert_eq!(ramp["sides"]["short"]["count"], json!(0), "{ramp}");
        assert!(ramp["sides"]["beyond"]["mean"].is_null(), "{ramp}");

        let mut missed = Vec::new();
        push_fmt(&mut missed, 129, "RATE", "Qff", "TimeUS,RDes,R");
        us = 0;
        for _ in 0..8 {
            rate_row(&mut missed, us, 0.0, 0.0);
            us += 50_000;
        }
        for _ in 0..8 {
            rate_row(&mut missed, us, 10.0, 1.0);
            us += 50_000;
        }
        let short = track_bytes(&missed, "RATE", "R", None, None);
        assert_eq!(short["holds"][0]["reached"], json!(false), "{short}");
        assert_eq!(short["holds"][0]["overshoot"], json!(0.0), "{short}");

        let mut many = Vec::new();
        push_fmt(&mut many, 129, "RATE", "Qff", "TimeUS,RDes,R");
        us = 0;
        let mut level = 0.0f32;
        rate_row(&mut many, us, level, level);
        us += 50_000;
        for _ in 0..7 {
            rate_row(&mut many, us, level, level);
            us += 50_000;
        }
        for (k, samples) in (4usize..=15).enumerate() {
            level = ((k + 1) * 10) as f32;
            for _ in 0..samples {
                rate_row(&mut many, us, level, level);
                us += 50_000;
            }
        }
        for step in [200.0f32, 280.0, 360.0, 440.0, 520.0] {
            rate_row(&mut many, us, step, step);
            us += 50_000;
        }
        for _ in 0..20 {
            rate_row(&mut many, us, 600.0, 600.0);
            us += 50_000;
        }
        let listed = track_bytes(&many, "RATE", "R", None, None);
        assert_eq!(listed["hold_count"], json!(13), "{listed}");
        let commands: Vec<f64> = listed["holds"].as_array().unwrap().iter().map(|entry| entry["command"].as_f64().unwrap()).collect();
        assert_eq!(commands.len(), 10, "{listed}");
        assert!(!commands.contains(&20.0), "{listed}");
        assert!(!commands.contains(&30.0), "{listed}");
        assert!(!commands.contains(&600.0), "{listed}");
        assert_eq!(commands, vec![10.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 110.0, 120.0], "{listed}");
    }

    #[test]
    fn sides_split_past_and_short_without_the_opposite_sign() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        for (us, desired, actual) in [
            (0u64, 10.0f32, 80.0),
            (100_000, 100.0, 140.0),
            (200_000, 100.0, 160.0),
            (300_000, 80.0, 50.0),
            (400_000, 40.0, -10.0),
            (500_000, 100.0, 100.0),
            (600_000, 0.0, 0.0),
        ] {
            rate_row(&mut buf, us, desired, actual);
        }
        let out = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(out["actual"], json!("R"), "{out}");
        assert_eq!(out["desired"], json!("RDes"), "{out}");
        assert_eq!(out["sides"]["active_count"], json!(5), "{out}");
        assert_eq!(out["sides"]["beyond"]["count"], json!(2), "{out}");
        assert_eq!(out["sides"]["beyond"]["share"], json!(0.4), "{out}");
        assert_eq!(out["sides"]["beyond"]["mean"], json!(50.0), "{out}");
        assert_eq!(out["sides"]["beyond"]["p95"], json!(60.0), "{out}");
        assert_eq!(out["sides"]["short"]["count"], json!(1), "{out}");
        assert_eq!(out["sides"]["short"]["share"], json!(0.2), "{out}");
        assert_eq!(out["sides"]["short"]["mean"], json!(30.0), "{out}");
        assert_eq!(out["sides"]["short"]["p95"], json!(30.0), "{out}");
    }

    #[test]
    fn a_heading_is_not_split_into_sides() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "ANG", "Qff", "TimeUS,DesYaw,Yaw");
        for (us, desired, actual) in [(0u64, 20.0f32, 10.0), (100_000, 40.0, 80.0), (200_000, 10.0, 20.0)] {
            sample_row(&mut buf, 129, us, &[desired, actual]);
        }
        let yaw = track_bytes(&buf, "ANG", "Yaw", None, None);
        assert_eq!(yaw["circular"], json!(true), "{yaw}");
        assert!(yaw["sides"].is_null(), "{yaw}");

        let mut rate = Vec::new();
        push_fmt(&mut rate, 129, "RATE", "Qff", "TimeUS,RDes,R");
        for (us, desired, actual) in [(0u64, 20.0f32, 10.0), (100_000, 40.0, 80.0), (200_000, 10.0, 20.0)] {
            rate_row(&mut rate, us, desired, actual);
        }
        let linear = track_bytes(&rate, "RATE", "R", None, None);
        assert_eq!(linear["sides"]["beyond"]["mean"], json!(25.0), "{linear}");
        assert_eq!(linear["sides"]["beyond"]["p95"], json!(40.0), "{linear}");
        assert_eq!(linear["sides"]["beyond"]["share"], json!(0.667), "{linear}");
        assert_eq!(linear["sides"]["short"]["mean"], json!(10.0), "{linear}");
        assert_eq!(linear["sides"]["short"]["share"], json!(0.333), "{linear}");
    }

    #[test]
    fn frf_measures_a_delay() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "RATE", "Qff", "TimeUS,RDes,R");
        let tones = [2.0_f64, 5.0, 8.0, 12.0];
        for i in 0..200 {
            let sample = |n: f64| tones.iter().map(|hz| (2.0 * std::f64::consts::PI * hz * n / 100.0).sin()).sum::<f64>();
            let desired = sample(i as f64);
            let actual = if i < 5 { 0.0 } else { sample(i as f64 - 5.0) };
            rate_row(&mut buf, i * 10_000, desired as f32, actual as f32);
        }
        let out = frf_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(out["ok"], json!(true), "{out}");
        let delay = out["group_delay_s"].as_f64().expect(&out.to_string());
        assert!((delay - 0.05).abs() < 0.03, "{out}");
        let bins = out["bins"].as_array().unwrap();
        let near = bins.iter().min_by(|a, b| {
            let da = (a["hz"].as_f64().unwrap() - 5.0).abs();
            let db = (b["hz"].as_f64().unwrap() - 5.0).abs();
            da.partial_cmp(&db).unwrap()
        }).unwrap();
        assert!(near["coherence"].as_f64().unwrap() > 0.4, "{near}");
        assert!(near["gain_db"].as_f64().unwrap().abs() < 8.0, "{near}");
    }

    #[test]
    fn a_line_that_moves_is_not_a_line_that_stays() {
        let points: Vec<RidgePoint> = (0..6).map(|i| RidgePoint {
            time_us: i * 1_000_000,
            hz: 80.0 + i as f64 * 12.0,
            amp: 10.0,
            more: [(50.0, 8.0), (0.0, 0.0)],
        }).collect();
        let refs: Vec<&RidgePoint> = points.iter().collect();
        let throttle: Vec<(u64, f64)> = (0..6).map(|i| (i * 1_000_000, 0.2 + i as f64 * 0.1)).collect();
        let lines = spectrum_lines(&refs, &throttle);
        let moving = lines.iter().find(|line| line["follows_throttle"] == json!(true)).expect(&format!("{lines:?}"));
        let fixed = lines.iter().find(|line| line["follows_throttle"] == json!(false)).expect(&format!("{lines:?}"));
        assert!(moving["hz_high"].as_f64().unwrap() > moving["hz_low"].as_f64().unwrap() + 20.0, "{moving}");
        assert!((fixed["hz"].as_f64().unwrap() - 50.0).abs() < 5.0, "{fixed}");
    }

    #[test]
    fn downloaded_rate_track_pairs_each_sample() {
        let roll = compute("002F00354D53501220303932/log-00006.bin", "RATE", "R", "track", Some(20_000_000), Some(100_000_000));
        let error = roll["error"].as_str().unwrap_or("");
        if error.contains("log not found") || error.contains("not in local storage") || error.contains("No such file") {
            return;
        }
        assert_eq!(roll["ok"], json!(true), "{roll}");
        assert!(roll["past_command"]["desired"].is_number(), "{roll}");
        assert!(roll["past_command"]["actual"].is_number(), "{roll}");
        assert!(roll["release"]["actual"].is_number() || roll["release"].is_null(), "{roll}");
    }

    #[test]
    fn tracking_keeps_the_highest_frequency_off_the_highest_throttle() {
        let columns = vec![
            json!({"db": 0.0, "hz": 100.0, "t_s": 1.0, "throttle": 0.2}),
            json!({"db": -1.0, "hz": 200.0, "t_s": 2.0, "throttle": 0.4}),
            json!({"db": -2.0, "hz": 150.0, "t_s": 3.0, "throttle": 0.6}),
            json!({"db": -40.0, "hz": 20.0, "t_s": 0.0, "throttle": 0.0}),
        ];
        let tracking = tracking_of(&columns);
        assert_eq!(tracking["loud_columns"], json!(3));
        assert_eq!(tracking["lowest_hz"]["hz"], json!(100.0));
        assert_eq!(tracking["lowest_hz"]["throttle"], json!(0.2));
        assert_eq!(tracking["highest_hz"]["throttle"], json!(0.4));
        assert_eq!(tracking["at_max_throttle"]["hz"], json!(150.0));
        assert_eq!(tracking["at_max_throttle"]["throttle"], json!(0.6));
        assert!(tracking["throttle_hz_r"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn missing_message_names_the_argument() {
        let out = compute("unused", "", "GyrX", "fft", None, None);
        let error = out["error"].as_str().unwrap();
        assert!(error.contains("message is required"));
        assert!(!error.contains("GyrX"));
    }

    #[test]
    fn gps_week_is_a_utc_date() {
        assert_eq!(unix_rfc3339(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(gps_rfc3339(2288, 252_818_000).as_deref(), Some("2023-11-14T22:13:20Z"));
        assert_eq!(onboard_id("002F/log-00032.bin"), Some(32));
        assert_eq!(onboard_id("002F/0123456789abcdef-6.bin"), Some(6));
        assert_eq!(onboard_id("002F/0123456789abcdef_20231114221320_6.bin"), Some(6));
        assert!(is_stored_copy("002F/094d906674953735_20260929185818_3.bin", 8_449_246, 3, 8_449_246));
        assert!(!is_stored_copy("002F/094d906674953735_20260929185818_3.bin", 8_449_246, 3, 5_000_000));
        assert!(!is_stored_copy("002F/094d906674953735_20260929185818_3.bin", 0, 3, 0));
        let named = downloaded_log_name(6, b"same", 1_700_000_000);
        assert!(named.ends_with("_20231114221320_6.bin"), "{named}");
        assert_eq!(named, downloaded_log_name(6, b"same", 1_700_000_000));
        assert_ne!(named, downloaded_log_name(6, b"other", 1_700_000_000));
        let foreign = import_log(b"not a log").unwrap_err();
        assert_eq!(foreign, "This file is not a DataFlash log.");
        let mut named_log = Vec::new();
        push_fmt(&mut named_log, 160, "MSG", "QZ", "TimeUS,Message");
        push_qz(&mut named_log, 160, 1, "JHEM_JHEF405 002F0035 4D535012 20303932");
        assert_eq!(vehicle_dir(&named_log), "002F00354D53501220303932");
        let mut unnamed = Vec::new();
        push_fmt(&mut unnamed, 160, "MSG", "QZ", "TimeUS,Message");
        push_qz(&mut unnamed, 160, 1, "ArduCopter V4.7.1");
        assert_eq!(vehicle_dir(&unnamed), "imported");
    }

    #[test]
    fn first_gps_time_stops_at_the_fix() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 130, "GPS", "QBIH", "TimeUS,Status,GMS,GWk");
        buf.extend_from_slice(&[HEAD1, HEAD2, 130]);
        buf.extend_from_slice(&1u64.to_le_bytes());
        buf.push(3);
        buf.extend_from_slice(&252_818_000u32.to_le_bytes());
        buf.extend_from_slice(&2288u16.to_le_bytes());
        assert_eq!(first_flight_utc(&buf).as_deref(), Some("2023-11-14T22:13:20Z"));
        let named = downloaded_log_name(2, &buf, 1_600_000_000);
        assert!(named.ends_with("_20231114221320_2.bin"), "{named}");
    }

    fn plain_row(us: u64, desired: f64, actual: f64) -> TrackRow {
        TrackRow { us, desired, actual, p: None, i: None, d: None, ff: None, dmod: None, output: None }
    }

    #[test]
    fn phases_keep_repeated_modes_as_separate_stretches() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 129, "MODE", "Qf", "TimeUS,ModeNum");
        push_fmt(&mut buf, 130, "ARM", "Qf", "TimeUS,ArmState");
        push_fmt(&mut buf, 131, "RATE", "Qf", "TimeUS,R");
        sample_row(&mut buf, 130, 10_000_000, &[1.0]);
        sample_row(&mut buf, 129, 10_000_000, &[2.0]);
        sample_row(&mut buf, 129, 20_000_000, &[22.0]);
        sample_row(&mut buf, 129, 25_000_000, &[2.0]);
        sample_row(&mut buf, 130, 30_000_000, &[0.0]);
        sample_row(&mut buf, 131, 31_000_000, &[0.0]);
        let (modes, armed) = flight_intervals(&buf);
        let modes = modes.as_array().unwrap();
        let armed = armed.as_array().unwrap();
        assert_eq!(modes.len(), 3);
        assert_eq!(modes[0]["state"], json!(2));
        assert_eq!(modes[0]["end_us"], json!(20_000_000));
        assert_eq!(modes[1]["state"], json!(22));
        assert_eq!(modes[2]["start_us"], json!(25_000_000));
        assert_eq!(modes[2]["end_us"], json!(31_000_000));
        assert_eq!(armed[0]["state"], json!(1));
        assert_eq!(armed[0]["end_us"], json!(30_000_000));
        assert_eq!(armed[1]["state"], json!(0));
        assert_eq!(armed[1]["end_us"], json!(31_000_000));
    }

    #[test]
    fn delay_zero_means_actual_was_already_there() {
        let already = vec![plain_row(0, 0.0, 80.0), plain_row(100_000, 100.0, 90.0)];
        let (delay, at_half) = step_delay_s(&already, &already[1]);
        assert!(delay.is_none());
        assert!(at_half);
        let rose = vec![plain_row(0, 0.0, 0.0), plain_row(100_000, 100.0, 10.0), plain_row(200_000, 100.0, 60.0)];
        let (delay, at_half) = step_delay_s(&rose, &rose[1]);
        assert_eq!(delay, Some(0.1));
        assert!(!at_half);
    }

    #[test]
    fn release_span_shows_one_move_beside_the_sign_count() {
        let rows = vec![
            plain_row(0, 0.0, 0.0),
            plain_row(100_000, 100.0, 50.0),
            plain_row(200_000, 0.5, 0.9),
            plain_row(300_000, 0.3, 0.6),
            plain_row(400_000, 0.1, 0.4),
            plain_row(500_000, -0.1, 0.0),
            plain_row(600_000, -0.4, -0.8),
        ];
        let motion = release_motion(&rows, &rows[1], false);
        assert_eq!(motion.actual_from, 0.9);
        assert_eq!(motion.actual_to, -0.8);
        assert_eq!(motion.crossings, 1);
        assert!((motion.error_span - 0.8).abs() < 0.05, "{}", motion.error_span);
    }

    #[test]
    fn track_reports_the_body_of_the_error_and_the_pid_terms() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 130, "PIDR", "Qfffffff", "TimeUS,Tar,Act,P,I,D,FF,Dmod");
        for (i, (tar, act)) in [(0.0f32, 0.0f32), (1.0, 2.0), (2.0, 4.0), (3.0, 6.0), (4.0, 8.0)].iter().enumerate() {
            buf.extend_from_slice(&[HEAD1, HEAD2, 130]);
            buf.extend_from_slice(&(i as u64 * 100_000).to_le_bytes());
            for value in [*tar, *act, 0.1, 0.01, 0.1, 0.02, 1.0] {
                buf.extend_from_slice(&value.to_le_bytes());
            }
        }
        let out = track_bytes(&buf, "PIDR", "Act", None, None);
        assert_eq!(out["error_p95"], json!(4.0), "{out}");
        assert_eq!(out["corr"], json!(1.0), "{out}");
        assert_eq!(out["spread"], json!(2.0), "{out}");
        assert_eq!(out["sample_hz"], json!(10.0), "{out}");
        assert_eq!(out["p_rms"], json!(0.1), "{out}");
        assert_eq!(out["p_share"], json!(0.488), "{out}");
        assert_eq!(out["i_share"], json!(0.005), "{out}");
        assert_eq!(out["d_share"], json!(0.488), "{out}");
        assert_eq!(out["ff_share"], json!(0.020), "{out}");
        assert!(out["error_peak_hz"].is_null(), "{out}");
        assert_eq!(out["dmod_min"], json!(1.0), "{out}");

        let mut yaw = Vec::new();
        push_fmt(&mut yaw, 131, "ANG", "Qff", "TimeUS,DesYaw,Yaw");
        sample_row(&mut yaw, 131, 0, &[10.0, 350.0]);
        sample_row(&mut yaw, 131, 100_000, &[20.0, 30.0]);
        let heading = track_bytes(&yaw, "ANG", "Yaw", None, None);
        assert!(heading["corr"].is_null(), "{heading}");
        assert!(heading["spread"].is_null(), "{heading}");
    }

    #[test]
    fn track_names_a_tone_in_the_error() {
        let rows: Vec<TrackRow> = (0..64).map(|i| {
            let t = i as f64 * 0.01;
            plain_row(i * 10_000, 0.0, (2.0 * std::f64::consts::PI * 5.0 * t).sin())
        }).collect();
        let out = track_rows(&rows, false);
        let hz = out["error_peak_hz"].as_f64().expect(&out.to_string());
        let share = out["error_peak_share"].as_f64().expect(&out.to_string());
        assert!((hz - 5.0).abs() < 1.0, "{out}");
        assert!(share > 0.15, "{out}");
        assert!(out["p_share"].is_null(), "{out}");
    }

    #[test]
    fn parm_rows_are_the_value_recorded_in_the_file() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 140, "PARM", "QNf", "TimeUS,Name,Value");
        let row = |buf: &mut Vec<u8>, us: u64, name: &str, value: f32| {
            buf.extend_from_slice(&[HEAD1, HEAD2, 140]);
            buf.extend_from_slice(&us.to_le_bytes());
            let mut bytes = [0u8; 16];
            bytes[..name.len()].copy_from_slice(name.as_bytes());
            buf.extend_from_slice(&bytes);
            buf.extend_from_slice(&value.to_le_bytes());
        };
        row(&mut buf, 0, "ATC_RAT_RLL_P", 0.5);
        row(&mut buf, 1_000_000, "ATC_RAT_RLL_P", 0.25);
        let out = parm_bytes(&buf, &["ATC_RAT_RLL_P".into(), "ATC_RAT_YAW_P".into()]);
        let params = out["params"].as_array().unwrap();
        assert_eq!(params[0]["value"], json!(0.25));
        assert_eq!(params[0]["first"], json!(0.5));
        assert_eq!(params[0]["changed"], json!(true));
        assert_eq!(params[1]["known"], json!(false));
    }

    #[test]
    fn track_lag_is_the_shift_of_the_interval_and_output_is_its_own_peak() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 130, "RATE", "Qfff", "TimeUS,RDes,R,ROut");
        for i in 0..20 {
            let desired = i as f32;
            let actual = if i < 2 { 0.0 } else { (i - 2) as f32 };
            buf.extend_from_slice(&[HEAD1, HEAD2, 130]);
            buf.extend_from_slice(&(i as u64 * 50_000).to_le_bytes());
            for value in [desired, actual, 1.0f32] {
                buf.extend_from_slice(&value.to_le_bytes());
            }
        }
        let out = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(out["lag_s"], json!(0.1), "{out}");
        assert_eq!(out["output_abs_max"], json!(1.0), "{out}");
        assert_eq!(out["output_at_peak"], json!(1.0), "{out}");
    }

    #[test]
    fn track_states_the_unit_the_log_recorded() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 117, "UNIT", "QbZ", "TimeUS,Id,Label");
        push_fmt(&mut buf, 116, "FMTU", "QBNN", "TimeUS,FmtType,UnitIds,MultIds");
        push_fmt(&mut buf, 130, "RATE", "Qff", "TimeUS,RDes,R");
        push_fmt(&mut buf, 131, "PIDR", "Qff", "TimeUS,Tar,Act");
        let mut unit = |id: i8, label: &str| {
            buf.extend_from_slice(&[HEAD1, HEAD2, 117]);
            buf.extend_from_slice(&0u64.to_le_bytes());
            buf.push(id as u8);
            let mut text = [0u8; 64];
            text[..label.len()].copy_from_slice(label.as_bytes());
            buf.extend_from_slice(&text);
        };
        unit(b's' as i8, "s");
        unit(b'k' as i8, "deg/s");
        let mut fmtu = |type_id: u8, codes: &str| {
            buf.extend_from_slice(&[HEAD1, HEAD2, 116]);
            buf.extend_from_slice(&0u64.to_le_bytes());
            buf.push(type_id);
            let mut ids = [0u8; 16];
            ids[..codes.len()].copy_from_slice(codes.as_bytes());
            buf.extend_from_slice(&ids);
            buf.extend_from_slice(&[0u8; 16]);
        };
        fmtu(130, "skk");
        fmtu(131, "s--");
        for i in 0..2 {
            buf.extend_from_slice(&[HEAD1, HEAD2, 130]);
            buf.extend_from_slice(&(i as u64 * 100_000).to_le_bytes());
            buf.extend_from_slice(&1.0f32.to_le_bytes());
            buf.extend_from_slice(&1.0f32.to_le_bytes());
            buf.extend_from_slice(&[HEAD1, HEAD2, 131]);
            buf.extend_from_slice(&(i as u64 * 100_000).to_le_bytes());
            buf.extend_from_slice(&0.4f32.to_le_bytes());
            buf.extend_from_slice(&0.4f32.to_le_bytes());
        }
        let rate = track_bytes(&buf, "RATE", "R", None, None);
        assert_eq!(rate["actual_unit"], json!("deg/s"), "{rate}");
        assert_eq!(rate["desired_unit"], json!("deg/s"), "{rate}");
        let pid = track_bytes(&buf, "PIDR", "Act", None, None);
        assert!(pid["actual_unit"].is_null(), "{pid}");
        assert!(pid["desired_unit"].is_null(), "{pid}");
        assert!((pid["error_rms"].as_f64().unwrap() - 0.0).abs() < 1e-9);
        let note = rate["note"].as_str().unwrap();
        assert!(note.contains("`spread` = std(`actual`) / std(`desired`).\n"), "{note}");
        assert!(note.contains("It is not a percent.\n"), "{note}");
        assert!(note.contains("The sentence is that the columns line up at this shift.\n"), "{note}");
        assert!(note.contains("It is not evidence that D is high, and it is not a reason to change D.\n"), "{note}");
        assert!(note.contains("A modest `corr` beside a small `error_rms` is a hold.\n"), "{note}");
        assert!(note.contains("not a frequency, not an overshoot, not damping, and not a gain."), "{note}");
        assert!(note.contains("`beyond` = |`actual`| - |`desired`|, where that is positive."), "{note}");
        assert!(note.contains("No samples on a side leaves `mean` and `p95` null."), "{note}");
        assert!(note.contains("It does not say why actual varied more, and it does not name a parameter."), "{note}");
        assert!(!note.contains("percent past the command"), "{note}");
        assert!(!note.contains("varied more than the command"), "{note}");
    }

    fn push_rate(buf: &mut Vec<u8>, type_id: u8, time: u64, actual: f32, desired: f32) {
        buf.extend_from_slice(&[HEAD1, HEAD2, type_id]);
        buf.extend_from_slice(&time.to_le_bytes());
        buf.extend_from_slice(&actual.to_le_bytes());
        buf.extend_from_slice(&desired.to_le_bytes());
    }

    #[test]
    fn a_chart_draws_every_sample() {
        let mut buf = Vec::new();
        push_fmt(&mut buf, 130, "RATE", "Qff", "TimeUS,R,RDes");
        for i in 0..900u64 {
            let y = if i == 450 { 50.0 } else { 0.1 };
            push_rate(&mut buf, 130, i * 20_000, y, 0.2);
        }
        let spec = json!({
            "title": "Pitch rate",
            "slug": " pitch ",
            "axes": [
                { "label": "deg/s", "lines": [
                    { "message": "RATE", "field": "R", "name": "actual" },
                    { "message": "RATE", "field": "RDes", "name": "desired" }
                ]},
                { "label": "extra", "lines": [ { "message": "RATE", "field": "Nope" } ]}
            ]
        });
        let out = chart_bytes(&buf, &spec);
        assert_eq!(out["ok"], json!(true), "{out}");
        assert_eq!(out["slug"], json!("pitch"));
        assert_eq!(out["chart"]["slug"], json!("pitch"));
        assert_eq!(out["chart"]["x_label"], json!("s"));
        let actual = &out["chart"]["axes"][0]["lines"][0];
        assert_eq!(actual["name"], json!("actual"));
        let n = actual["y"].as_array().unwrap().len();
        assert_eq!(n, 900, "{n}");
        let peak = actual["y"].as_array().unwrap().iter().filter_map(|v| v.as_f64()).fold(0.0_f64, f64::max);
        assert!((peak - 50.0).abs() < 1e-6, "{peak}");
        assert_eq!(out["chart"]["axes"][0]["lines"][1]["name"], json!("desired"));
        assert!(out["note"].as_str().unwrap().contains("RATE.Nope is not in this log"));
        let missing = chart_bytes(&buf, &json!({ "axes": [] }));
        assert_eq!(missing["ok"], json!(false));
    }
}
