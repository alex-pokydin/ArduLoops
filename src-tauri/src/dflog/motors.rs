// Motor thrust balance, center-of-gravity (CG) offset and yaw twist diagnostics from DataFlash logs.

#[derive(Clone, Debug, Default)]
struct MotorStat {
    count: usize,
    sum_rcou: f64,
    min_rcou: f64,
    max_rcou: f64,
    sum_rpm: f64,
    count_rpm: usize,
    sum_temp: f64,
    count_temp: usize,
    sum_curr: f64,
    count_curr: usize,
}

pub fn motor_balance_bytes(
    bytes: &[u8],
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let formats = parse_formats(bytes);
    if formats.is_empty() {
        return json!({ "ok": false, "error": "No message format headers found in log" });
    }

    let mut parms: BTreeMap<String, f64> = BTreeMap::new();
    let mut incomplete = false;

    // First scan parameters to find active motors and frame
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name == "PARM" {
            if let (Some(name), Some(val)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                if name.starts_with("SERVO") || name.starts_with("FRAME_") || name.starts_with("MOT_") {
                    parms.insert(name, val);
                }
            }
        }
    }, &mut incomplete);

    // Determine number of active motors and mapping
    let mut motor_channels = Vec::new();
    for i in 1..=12 {
        let key = format!("SERVO{}_FUNCTION", i);
        if let Some(&fn_val) = parms.get(&key) {
            let f = fn_val as u32;
            if (33..=44).contains(&f) {
                motor_channels.push((f - 32, i)); // (motor_idx, servo_channel)
            }
        }
    }
    motor_channels.sort_by_key(|m| m.0);

    // Default to 4 motors (channels 1..4) if no explicit SERVO functions mapped
    if motor_channels.is_empty() {
        for i in 1..=4 {
            motor_channels.push((i, i));
        }
    }
    let num_motors = motor_channels.len();

    let mut stats: Vec<MotorStat> = (0..num_motors).map(|_| MotorStat {
        min_rcou: 3000.0,
        max_rcou: 0.0,
        ..Default::default()
    }).collect();

    let mut hover_start_us = 0u64;
    let mut hover_end_us = 0u64;

    // RCOU field names
    let rcou_names: Vec<String> = motor_channels.iter().map(|(_, ch)| format!("C{}", ch)).collect();

    walk(bytes, &formats, |fmt, _, values| {
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }

        if fmt.name == "RCOU" {
            // Read motor channels
            let mut row_vals = Vec::with_capacity(num_motors);
            for name in &rcou_names {
                if let Some(v) = field_f64(fmt, values, name) {
                    if v > 900.0 && v < 2200.0 {
                        row_vals.push(v);
                    }
                }
            }
            if row_vals.len() == num_motors {
                // Filter out zero-throttle or landed samples (< 1100 us)
                let avg = row_vals.iter().sum::<f64>() / num_motors as f64;
                if avg > 1150.0 {
                    if hover_start_us == 0 {
                        hover_start_us = us;
                    }
                    hover_end_us = us;
                    for (i, &v) in row_vals.iter().enumerate() {
                        let st = &mut stats[i];
                        st.count += 1;
                        st.sum_rcou += v;
                        st.min_rcou = st.min_rcou.min(v);
                        st.max_rcou = st.max_rcou.max(v);
                    }
                }
            }
        } else if fmt.name == "ESC" {
            // ESC telemetry: RPM, Curr, Temp
            let inst = field_u64(fmt, values, "Instance").unwrap_or(0) as usize;
            if inst < num_motors {
                let st = &mut stats[inst];
                if let Some(rpm) = field_f64(fmt, values, "RPM") {
                    if rpm > 500.0 {
                        st.sum_rpm += rpm;
                        st.count_rpm += 1;
                    }
                }
                if let Some(temp) = field_f64(fmt, values, "Temp") {
                    if temp > 0.0 && temp < 150.0 {
                        st.sum_temp += temp;
                        st.count_temp += 1;
                    }
                }
                if let Some(curr) = field_f64(fmt, values, "Curr") {
                    if curr >= 0.0 {
                        st.sum_curr += curr;
                        st.count_curr += 1;
                    }
                }
            }
        }
    }, &mut incomplete);

    let total_samples = stats.iter().map(|s| s.count).max().unwrap_or(0);
    if total_samples < 50 {
        return json!({
            "ok": false,
            "error": "Insufficient armed in-flight motor output samples in selected interval."
        });
    }

    let motor_means: Vec<f64> = stats.iter().map(|s| if s.count > 0 { s.sum_rcou / s.count as f64 } else { 0.0 }).collect();
    let overall_mean = motor_means.iter().sum::<f64>() / num_motors as f64;

    let mut motor_rows = Vec::new();
    for (i, &mean) in motor_means.iter().enumerate() {
        let diff_pct = if overall_mean > 0.0 {
            (mean - overall_mean) / overall_mean * 100.0
        } else {
            0.0
        };
        let (m_idx, ch) = motor_channels[i];
        let st = &stats[i];
        let mut row = json!({
            "motor": m_idx,
            "channel": ch,
            "samples": st.count,
            "avg_pwm": (mean * 10.0).round() / 10.0,
            "min_pwm": (st.min_rcou * 10.0).round() / 10.0,
            "max_pwm": (st.max_rcou * 10.0).round() / 10.0,
            "diff_pct": (diff_pct * 10.0).round() / 10.0,
        });
        if st.count_rpm > 0 {
            row["avg_rpm"] = json!((st.sum_rpm / st.count_rpm as f64).round());
        }
        if st.count_temp > 0 {
            row["avg_temp_c"] = json!(((st.sum_temp / st.count_temp as f64) * 10.0).round() / 10.0);
        }
        if st.count_curr > 0 {
            row["avg_curr_a"] = json!(((st.sum_curr / st.count_curr as f64) * 10.0).round() / 10.0);
        }
        motor_rows.push(row);
    }

    // Diagnostics for standard Quadcopter (X frame: 1=FrontRight/CCW, 2=RearLeft/CCW, 3=FrontLeft/CW, 4=RearRight/CW)
    let mut issues = Vec::new();
    let mut cg_roll_pct = 0.0;
    let mut cg_pitch_pct = 0.0;
    let mut yaw_twist_pct = 0.0;

    if num_motors == 4 {
        let m1 = motor_means[0];
        let m2 = motor_means[1];
        let m3 = motor_means[2];
        let m4 = motor_means[3];

        // Front: 1, 3. Rear: 2, 4.
        let front = (m1 + m3) * 0.5;
        let rear = (m2 + m4) * 0.5;
        cg_pitch_pct = ((front - rear) / overall_mean * 100.0 * 10.0).round() / 10.0;

        // Left: 2, 3. Right: 1, 4.
        let left = (m2 + m3) * 0.5;
        let right = (m1 + m4) * 0.5;
        cg_roll_pct = ((left - right) / overall_mean * 100.0 * 10.0).round() / 10.0;

        // CW: 3, 4. CCW: 1, 2.
        let ccw = (m1 + m2) * 0.5;
        let cw = (m3 + m4) * 0.5;
        yaw_twist_pct = ((cw - ccw) / overall_mean * 100.0 * 10.0).round() / 10.0;

        if cg_pitch_pct > 6.0 {
            issues.push(format!("Forward CG bias ({:+.1}%): Front motors work harder than rear. Move battery backward to center mass.", cg_pitch_pct));
        } else if cg_pitch_pct < -6.0 {
            issues.push(format!("Aft CG bias ({:+.1}%): Rear motors work harder than front. Move battery forward to center mass.", cg_pitch_pct));
        }

        if cg_roll_pct.abs() > 6.0 {
            let side = if cg_roll_pct > 0.0 { "Left" } else { "Right" };
            issues.push(format!("Lateral CG bias ({:+.1}%): {} motors work harder. Rebalance payload sideways.", cg_roll_pct, side));
        }

        if yaw_twist_pct.abs() > 4.5 {
            issues.push(format!("Motor mount twist / yaw bias detected ({:+.1}% difference between CW and CCW pairs). Inspect arm alignment and motor perpendicularity.", yaw_twist_pct));
        }
    }

    // Check for any single outlier motor
    for (i, &mean) in motor_means.iter().enumerate() {
        let diff = (mean - overall_mean) / overall_mean * 100.0;
        if diff.abs() > 12.0 {
            let (m_idx, _) = motor_channels[i];
            issues.push(format!("Motor {} has severe thrust discrepancy ({:+.1}% vs average). Inspect propeller, motor bearings, or ESC calibration.", m_idx, diff));
        }
    }

    let is_balanced = issues.is_empty();

    let chart_lines: Vec<Value> = motor_channels.iter().take(8).map(|(m_idx, ch)| {
        json!({
            "message": "RCOU",
            "field": format!("C{}", ch),
            "name": format!("Motor {}", m_idx)
        })
    }).collect();

    let chart_start = if hover_end_us > hover_start_us + 10_000_000 {
        hover_start_us + (hover_end_us - hover_start_us) / 2
    } else {
        hover_start_us
    };
    let chart_end = (chart_start + 6_000_000).min(hover_end_us);

    let suggested_chart = json!({
        "title": "Motor Output PWM Balance (Hover)",
        "start_us": chart_start,
        "end_us": chart_end,
        "axes": [{
            "label": "PWM (us)",
            "lines": chart_lines
        }]
    });

    json!({
        "ok": true,
        "hover_interval": {
            "start_us": hover_start_us,
            "end_us": hover_end_us
        },
        "suggested_chart": suggested_chart,
        "motors_count": num_motors,
        "flight_samples": total_samples,
        "overall_avg_pwm": (overall_mean * 10.0).round() / 10.0,
        "motors": motor_rows,
        "balance": {
            "cg_pitch_bias_pct": cg_pitch_pct,
            "cg_roll_bias_pct": cg_roll_pct,
            "yaw_twist_pct": yaw_twist_pct,
            "status": if is_balanced { "balanced" } else { "imbalanced" }
        },
        "issues": issues,
        "recommendation": if is_balanced {
            "Motor thrust distribution is well balanced. Center of gravity and motor alignments are nominal."
        } else {
            "Address CG offset and motor twist issues noted above to prevent early motor saturation and reduce battery consumption."
        }
    })
}

pub fn motor_balance(
    id: &str,
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let bytes = match read_id(id) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    motor_balance_bytes(&bytes, start_us, end_us)
}
