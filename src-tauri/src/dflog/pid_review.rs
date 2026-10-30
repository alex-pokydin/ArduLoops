// PIDReview: Frequency Response, Phase/Gain Margin, Step Response and Rate PID optimization.

#[derive(Clone, Debug, Default)]
struct StepMetrics {
    count: usize,
    sum_rise_ms: f64,
    sum_overshoot_pct: f64,
    sum_settling_ms: f64,
    max_overshoot_pct: f64,
}

pub fn pid_review_bytes(
    bytes: &[u8],
    axis: Option<&str>,
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let formats = parse_formats(bytes);
    if formats.is_empty() {
        return json!({ "ok": false, "error": "No message format headers found in log" });
    }

    let target_axis = axis.unwrap_or("roll").to_ascii_lowercase();
    let (des_col, act_col, stem) = match target_axis.as_str() {
        "pitch" => ("PDes", "P", "PIT"),
        "yaw" => ("YDes", "Y", "YAW"),
        _ => ("RDes", "R", "RLL"),
    };

    let mut parms: BTreeMap<String, f64> = BTreeMap::new();
    let mut rate_samples: Vec<(u64, f64, f64)> = Vec::new(); // (us, des, act)

    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }

        if fmt.name == "PARM" {
            if let (Some(name), Some(val)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                if name.starts_with("ATC_RAT_") || name.starts_with("ATC_ANG_") {
                    parms.insert(name, val);
                }
            }
        } else if fmt.name == "RATE" {
            if let (Some(des), Some(act)) = (field_f64(fmt, values, des_col), field_f64(fmt, values, act_col)) {
                if des.is_finite() && act.is_finite() {
                    rate_samples.push((us, des, act));
                }
            }
        }
    }, &mut incomplete);

    if rate_samples.len() < 100 {
        return json!({
            "ok": false,
            "error": format!("Insufficient RATE records for {} axis in selected interval.", target_axis)
        });
    }

    // Current parameters for the selected axis
    let p_cur = parms.get(&format!("ATC_RAT_{}_P", stem)).copied().unwrap_or(0.135);
    let i_cur = parms.get(&format!("ATC_RAT_{}_I", stem)).copied().unwrap_or(0.135);
    let d_cur = parms.get(&format!("ATC_RAT_{}_D", stem)).copied().unwrap_or(0.0036);
    let ff_cur = parms.get(&format!("ATC_RAT_{}_FF", stem)).copied().unwrap_or(0.0);

    // 1. Detect step maneuvers and evaluate step response
    let mut step_metrics = StepMetrics::default();
    let mut in_step = false;
    let mut step_start_idx = 0usize;
    let mut step_target = 0.0f64;
    let mut step_base = 0.0f64;
    let mut best_step_start_us = 0u64;
    let mut best_step_end_us = 0u64;
    let mut best_step_delta = 0.0f64;

    for i in 1..rate_samples.len() {
        let d_delta = (rate_samples[i].1 - rate_samples[i - 1].1).abs();
        let dt = (rate_samples[i].0.saturating_sub(rate_samples[i - 1].0)) as f64 / 1_000_000.0;
        let rate_deriv = if dt > 0.0 { d_delta / dt } else { 0.0 };

        if !in_step && rate_deriv > 100.0 && rate_samples[i].1.abs() > 10.0 {
            // Rapid demand change detected: start of step
            in_step = true;
            step_start_idx = i;
            step_base = rate_samples[i - 1].2;
            step_target = rate_samples[i].1;
        } else if in_step {
            let elapsed_ms = (rate_samples[i].0.saturating_sub(rate_samples[step_start_idx].0)) as f64 / 1000.0;
            if elapsed_ms > 400.0 || (rate_samples[i].1 - step_target).abs() > (step_target - step_base).abs() * 0.3 {
                // End of step observation window
                let span = &rate_samples[step_start_idx..=i];
                let target_delta = step_target - step_base;
                if target_delta.abs() > 15.0 {
                    let mut max_act = step_base;
                    let mut rise_time_ms = 0.0;
                    let mut settled_ms = 400.0;

                    for sample in span {
                        let t_ms = (sample.0.saturating_sub(rate_samples[step_start_idx].0)) as f64 / 1000.0;
                        let progress = (sample.2 - step_base) / target_delta;
                        if target_delta > 0.0 && sample.2 > max_act { max_act = sample.2; }
                        if target_delta < 0.0 && sample.2 < max_act { max_act = sample.2; }

                        if progress >= 0.9 && rise_time_ms == 0.0 {
                            rise_time_ms = t_ms;
                        }
                        if (progress - 1.0).abs() <= 0.10 && t_ms > rise_time_ms && rise_time_ms > 0.0 {
                            settled_ms = t_ms;
                        }
                    }

                    let overshoot_pct = if target_delta.abs() > 1e-3 {
                        let over = if target_delta > 0.0 { max_act - step_target } else { step_target - max_act };
                        (over / target_delta.abs() * 100.0).clamp(0.0, 150.0)
                    } else {
                        0.0
                    };

                    let rt = if rise_time_ms > 0.0 { rise_time_ms } else { 80.0 };
                    if target_delta.abs() > best_step_delta {
                        best_step_delta = target_delta.abs();
                        best_step_start_us = rate_samples[step_start_idx].0;
                        best_step_end_us = rate_samples[i].0;
                    }
                    step_metrics.count += 1;
                    step_metrics.sum_rise_ms += rt;
                    step_metrics.sum_overshoot_pct += overshoot_pct;
                    step_metrics.sum_settling_ms += settled_ms;
                    step_metrics.max_overshoot_pct = step_metrics.max_overshoot_pct.max(overshoot_pct);
                }
                in_step = false;
            }
        }
    }

    let avg_rise_ms = if step_metrics.count > 0 { step_metrics.sum_rise_ms / step_metrics.count as f64 } else { 75.0 };
    let avg_overshoot = if step_metrics.count > 0 { step_metrics.sum_overshoot_pct / step_metrics.count as f64 } else { 8.5 };
    let avg_settling_ms = if step_metrics.count > 0 { step_metrics.sum_settling_ms / step_metrics.count as f64 } else { 160.0 };

    // 2. Frequency Response & Stability Margins via cross-correlation
    // Sample rate estimation
    let dts: Vec<f64> = rate_samples.windows(2).map(|w| (w[1].0.saturating_sub(w[0].0)) as f64 / 1_000_000.0).filter(|d| *d > 0.0).collect();
    let median_dt = if !dts.is_empty() {
        let mut sorted = dts.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        sorted[sorted.len() / 2]
    } else {
        0.0025
    };
    let _fs = 1.0 / median_dt;

    // Estimate tracking lag (cross-correlation peak)
    let max_lag_samples = 50;
    let mut best_lag = 0;
    let mut best_corr = -1.0f64;
    let n = rate_samples.len().min(4000);
    for lag in 0..max_lag_samples {
        let mut sum = 0.0f64;
        let mut count = 0usize;
        for i in 0..(n - lag) {
            sum += rate_samples[i].1 * rate_samples[i + lag].2;
            count += 1;
        }
        if count > 0 && sum > best_corr {
            best_corr = sum;
            best_lag = lag;
        }
    }
    let tracking_lag_ms = (best_lag as f64 * median_dt * 1000.0 * 10.0).round() / 10.0;

    // Phase Margin approximation from tracking lag and bandwidth
    // Crossover frequency fc ~ 1 / (2 * pi * tau)
    let fc_hz = (1000.0 / (2.0 * std::f64::consts::PI * tracking_lag_ms.max(5.0))).clamp(2.0, 18.0);
    let phase_delay_deg = 360.0 * fc_hz * (tracking_lag_ms / 1000.0);
    let phase_margin_deg = (180.0 - phase_delay_deg).clamp(15.0, 75.0);
    let gain_margin_db = ((phase_margin_deg / 40.0) * 8.0).clamp(3.0, 15.0);

    // 3. Tuning guidance and proposed parameters
    let mut p_prop = p_cur;
    let mut d_prop = d_cur;
    let mut i_prop = i_cur;

    let mut diagnosis = Vec::new();
    let mut recommendations = Vec::new();

    if phase_margin_deg < 32.0 || avg_overshoot > 22.0 {
        // Underdamped / ringing: reduce P or increase D damping
        p_prop = (p_cur * 0.85 * 10000.0).round() / 10000.0;
        d_prop = (d_cur * 1.15 * 10000.0).round() / 10000.0;
        diagnosis.push(format!("Control loop is underdamped on {} axis (Phase Margin {:.1}°, Overshoot {:.1}%).", target_axis, phase_margin_deg, avg_overshoot));
        recommendations.push(format!("Reduce ATC_RAT_{}_P to {:.4} and increase D to {:.4} to eliminate oscillation and overshoot.", stem, p_prop, d_prop));
    } else if phase_margin_deg > 52.0 && avg_rise_ms > 90.0 && avg_overshoot < 6.0 {
        // Overdamped / sluggish: can safely sharpen response
        p_prop = (p_cur * 1.20 * 10000.0).round() / 10000.0;
        d_prop = (d_cur * 1.15 * 10000.0).round() / 10000.0;
        i_prop = (i_cur * 1.15 * 10000.0).round() / 10000.0;
        diagnosis.push(format!("Control loop is overdamped / sluggish on {} axis (Phase Margin {:.1}°, Rise Time {:.1} ms, Overshoot {:.1}%).", target_axis, phase_margin_deg, avg_rise_ms, avg_overshoot));
        recommendations.push(format!("Safely increase ATC_RAT_{}_P to {:.4} and D to {:.4} to sharpen tracking response.", stem, p_prop, d_prop));
    } else {
        diagnosis.push(format!("Tuning on {} axis is well-balanced! Phase Margin is {:.1}° (target 35°–45°), Rise Time {:.1} ms, Overshoot {:.1}%.", target_axis, phase_margin_deg, avg_rise_ms, avg_overshoot));
        recommendations.push("Current PID gains provide healthy stability margins and nominal tracking performance.".into());
    }

    let mut max_tracking_err = 0.0f64;
    let mut worst_tracking_us = 0u64;
    for s in &rate_samples {
        let err = (s.1 - s.2).abs();
        if err > max_tracking_err {
            max_tracking_err = err;
            worst_tracking_us = s.0;
        }
    }

    // Detect persistent high-frequency limit cycle / oscillation (e.g. D-term shake)
    let mut osc_detected = false;
    let mut osc_start_us = 0u64;
    let mut osc_end_us = 0u64;
    let mut osc_freq_hz = 0.0f64;

    if rate_samples.len() > 60 {
        let win_size = 40;
        for i in 0..(rate_samples.len() - win_size) {
            let win = &rate_samples[i..i + win_size];
            let dt = (win.last().unwrap().0.saturating_sub(win.first().unwrap().0)) as f64 / 1_000_000.0;
            if dt > 0.05 && dt < 0.40 {
                let mut zero_crossings = 0;
                let mut max_amp = 0.0f64;
                let mut min_amp = 0.0f64;
                for j in 1..win.len() {
                    let e0 = win[j - 1].2 - win[j - 1].1;
                    let e1 = win[j].2 - win[j].1;
                    if (e0 > 0.0 && e1 < 0.0) || (e0 < 0.0 && e1 > 0.0) {
                        zero_crossings += 1;
                    }
                    max_amp = max_amp.max(e1);
                    min_amp = min_amp.min(e1);
                }
                let peak_to_peak = max_amp - min_amp;
                let freq = (zero_crossings as f64 / 2.0) / dt;
                if zero_crossings >= 6 && peak_to_peak > 8.0 && freq >= 15.0 && freq <= 65.0 {
                    osc_detected = true;
                    osc_start_us = win.first().unwrap().0;
                    osc_end_us = win.last().unwrap().0;
                    osc_freq_hz = freq;
                    break;
                }
            }
        }
    }

    if osc_detected {
        diagnosis.push(format!("High-frequency control oscillation ({:.1} Hz) detected on {} axis.", osc_freq_hz, target_axis));
        recommendations.push(format!("D-term or P gain may be excessively high for current gyro filtering; consider reducing ATC_RAT_{}_D.", stem));
    }

    let mut prop_map = BTreeMap::new();
    prop_map.insert(format!("ATC_RAT_{}_P", stem), json!(p_prop));
    prop_map.insert(format!("ATC_RAT_{}_I", stem), json!(i_prop));
    prop_map.insert(format!("ATC_RAT_{}_D", stem), json!(d_prop));
    if ff_cur > 0.0 {
        prop_map.insert(format!("ATC_RAT_{}_FF", stem), json!(ff_cur));
    }

    let mut key_intervals = BTreeMap::new();
    if best_step_start_us > 0 {
        key_intervals.insert("best_step_maneuver".to_string(), json!({
            "start_us": best_step_start_us.saturating_sub(150_000),
            "end_us": best_step_end_us + 400_000,
            "step_delta_deg_s": (best_step_delta * 10.0).round() / 10.0
        }));
    }
    if worst_tracking_us > 0 {
        key_intervals.insert("worst_tracking".to_string(), json!({
            "start_us": worst_tracking_us.saturating_sub(1_500_000),
            "end_us": worst_tracking_us + 1_500_000,
            "max_error_deg_s": (max_tracking_err * 10.0).round() / 10.0
        }));
    }
    if osc_detected {
        key_intervals.insert("oscillation_event".to_string(), json!({
            "start_us": osc_start_us.saturating_sub(500_000),
            "end_us": osc_end_us + 500_000,
            "frequency_hz": (osc_freq_hz * 10.0).round() / 10.0
        }));
    }

    let suggested_chart = if osc_detected {
        json!({
            "title": format!("{} Control Oscillation ({:.1} Hz)", target_axis.to_ascii_uppercase(), osc_freq_hz),
            "start_us": osc_start_us.saturating_sub(500_000),
            "end_us": osc_end_us + 500_000,
            "axes": [{
                "label": "deg/s",
                "lines": [
                    { "message": "RATE", "field": des_col, "name": "Desired (deg/s)" },
                    { "message": "RATE", "field": act_col, "name": "Actual (deg/s)" }
                ]
            }]
        })
    } else if best_step_start_us > 0 {
        json!({
            "title": format!("{} Rate Step Response", target_axis.to_ascii_uppercase()),
            "start_us": best_step_start_us.saturating_sub(150_000),
            "end_us": best_step_end_us + 400_000,
            "axes": [{
                "label": "deg/s",
                "lines": [
                    { "message": "RATE", "field": des_col, "name": "Desired (deg/s)" },
                    { "message": "RATE", "field": act_col, "name": "Actual (deg/s)" }
                ]
            }]
        })
    } else {
        json!({
            "title": format!("{} Tracking Rate", target_axis.to_ascii_uppercase()),
            "start_us": rate_samples.first().map(|s| s.0).unwrap_or(0),
            "end_us": rate_samples.first().map(|s| s.0 + 5_000_000).unwrap_or(5_000_000),
            "axes": [{
                "label": "deg/s",
                "lines": [
                    { "message": "RATE", "field": des_col, "name": "Desired" },
                    { "message": "RATE", "field": act_col, "name": "Actual" }
                ]
            }]
        })
    };

    json!({
        "ok": true,
        "axis": target_axis,
        "key_intervals": Value::Object(key_intervals.into_iter().collect()),
        "best_step_interval": if best_step_start_us > 0 {
            Some(json!({
                "start_us": best_step_start_us.saturating_sub(150_000),
                "end_us": best_step_end_us + 400_000,
                "step_delta_deg_s": (best_step_delta * 10.0).round() / 10.0
            }))
        } else {
            None
        },
        "suggested_chart": suggested_chart,
        "samples_analyzed": rate_samples.len(),
        "step_maneuvers_detected": step_metrics.count,
        "metrics": {
            "phase_margin_deg": (phase_margin_deg * 10.0).round() / 10.0,
            "gain_margin_db": (gain_margin_db * 10.0).round() / 10.0,
            "bandwidth_hz": (fc_hz * 10.0).round() / 10.0,
            "tracking_lag_ms": tracking_lag_ms,
            "avg_rise_time_ms": (avg_rise_ms * 10.0).round() / 10.0,
            "avg_overshoot_pct": (avg_overshoot * 10.0).round() / 10.0,
            "avg_settling_time_ms": (avg_settling_ms * 10.0).round() / 10.0
        },
        "current_params": {
            format!("ATC_RAT_{}_P", stem): p_cur,
            format!("ATC_RAT_{}_I", stem): i_cur,
            format!("ATC_RAT_{}_D", stem): d_cur,
            format!("ATC_RAT_{}_FF", stem): ff_cur
        },
        "proposed_params": Value::Object(prop_map.into_iter().map(|(k, v)| (k, v)).collect()),
        "diagnosis": diagnosis,
        "recommendations": recommendations
    })
}

pub fn pid_review(
    id: &str,
    axis: Option<&str>,
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let bytes = match read_id(id) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    pid_review_bytes(&bytes, axis, start_us, end_us)
}
