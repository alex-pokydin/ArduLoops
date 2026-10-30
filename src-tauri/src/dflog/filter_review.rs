// FilterReview: Gyro noise analysis, harmonic notch parameter optimization and virtual filter simulation.

/// Computes the complex frequency response H(f) of a digital biquad notch filter,
/// exactly matching ArduPilot WebTools FilterReview.js and ArduPilot HarmonicNotchFilter.
pub fn notch_response(f0: f64, bw: f64, fs: f64, f: f64) -> (f64, f64) {
    if fs <= 0.0 || f0 <= 0.0 || bw <= 0.0 || f0 <= 0.5 * bw || f0 >= 0.5 * fs {
        return (1.0, 0.0);
    }
    let pi = std::f64::consts::PI;
    let octaves = (f0 / (f0 - bw * 0.5)).log2() * 2.0;
    let pow2 = 2.0f64.powf(octaves);
    let q = (pow2.sqrt() / (pow2 - 1.0)).clamp(0.1, 100.0);

    // Default attenuation: -40 dB -> A = 10^(-40/40) = 0.1
    let a = 0.1;
    let a_sq = a * a;

    let omega0 = 2.0 * pi * f0 / fs;
    let alpha = omega0.sin() / (2.0 * q);

    let b0 = 1.0 + alpha * a_sq;
    let b1 = -2.0 * omega0.cos();
    let b2 = 1.0 - alpha * a_sq;
    let a0 = 1.0 + alpha;
    let a1 = b1;
    let a2 = 1.0 - alpha;

    let w = 2.0 * pi * f / fs;
    let cos_w = w.cos();
    let sin_w = w.sin();
    let cos_2w = (2.0 * w).cos();
    let sin_2w = (2.0 * w).sin();

    let num_re = b0 + b1 * cos_w + b2 * cos_2w;
    let num_im = -b1 * sin_w - b2 * sin_2w;

    let den_re = a0 + a1 * cos_w + a2 * cos_2w;
    let den_im = -a1 * sin_w - a2 * sin_2w;

    let den_mag2 = den_re * den_re + den_im * den_im;
    if den_mag2 < 1e-12 {
        return (0.0, 0.0);
    }

    let h_re = (num_re * den_re + num_im * den_im) / den_mag2;
    let h_im = (num_im * den_re - num_re * den_im) / den_mag2;
    let gain = (h_re * h_re + h_im * h_im).sqrt();
    let phase = h_im.atan2(h_re);
    (gain, phase)
}

/// Computes the frequency response of a 2nd order Butterworth Low-Pass Filter,
/// matching ArduPilot DigitalBiquadFilter in WebTools FilterReview.js.
pub fn lpf_response(cutoff_hz: f64, fs: f64, f: f64) -> (f64, f64) {
    if fs <= 0.0 || cutoff_hz <= 0.0 || cutoff_hz >= fs * 0.5 {
        return (1.0, 0.0);
    }
    let pi = std::f64::consts::PI;
    let fr = fs / cutoff_hz;
    let ohm = (pi / fr).tan();
    let c = 1.0 + 2.0 * (pi / 4.0).cos() * ohm + ohm * ohm;

    let b0 = (ohm * ohm) / c;
    let b1 = 2.0 * b0;
    let b2 = b0;
    let a1 = 2.0 * (ohm * ohm - 1.0) / c;
    let a2 = (1.0 - 2.0 * (pi / 4.0).cos() * ohm + ohm * ohm) / c;

    let w = 2.0 * pi * f / fs;
    let cos_w = w.cos();
    let sin_w = w.sin();
    let cos_2w = (2.0 * w).cos();
    let sin_2w = (2.0 * w).sin();

    let num_re = b0 + b1 * cos_w + b2 * cos_2w;
    let num_im = -b1 * sin_w - b2 * sin_2w;

    let den_re = 1.0 + a1 * cos_w + a2 * cos_2w;
    let den_im = -a1 * sin_w - a2 * sin_2w;

    let den_mag2 = den_re * den_re + den_im * den_im;
    if den_mag2 < 1e-12 {
        return (0.0, 0.0);
    }

    let h_re = (num_re * den_re + num_im * den_im) / den_mag2;
    let h_im = (num_im * den_re - num_re * den_im) / den_mag2;
    let gain = (h_re * h_re + h_im * h_im).sqrt();
    let phase = h_im.atan2(h_re);
    (gain, phase)
}

/// Simulated harmonic notch filter performance.
#[derive(Clone, Debug)]
pub struct FilterSimResult {
    pub noise_attenuation_db: f64,
    pub phase_delay_at_30hz_ms: f64,
}

pub fn simulate_filter(
    freq: f64,
    bw: f64,
    harmonics_mask: u32,
    lpf_hz: f64,
    sample_rate: f64,
    raw_spectrum: &[(f64, f64)], // (freq_hz, amp)
) -> FilterSimResult {
    if raw_spectrum.is_empty() || sample_rate <= 0.0 {
        return FilterSimResult {
            noise_attenuation_db: 0.0,
            phase_delay_at_30hz_ms: 0.0,
        };
    }

    // Determine active notch harmonic frequencies
    let mut notch_freqs = Vec::new();
    for h in 0..8 {
        if (harmonics_mask & (1 << h)) != 0 {
            notch_freqs.push(freq * (h + 1) as f64);
        }
    }

    let mut in_noise_power = 0.0;
    let mut out_noise_power = 0.0;

    for &(f, amp) in raw_spectrum {
        if f < 20.0 {
            continue; // Skip aircraft control motion band (< 20 Hz)
        }
        let mut total_gain = 1.0;
        for &nf in &notch_freqs {
            let (g, _) = notch_response(nf, bw, sample_rate, f);
            total_gain *= g;
        }
        if lpf_hz > 0.0 {
            let (lg, _) = lpf_response(lpf_hz, sample_rate, f);
            total_gain *= lg;
        }

        let p_in = amp * amp;
        let p_out = p_in * (total_gain * total_gain);
        in_noise_power += p_in;
        out_noise_power += p_out;
    }

    let attenuation_db = if in_noise_power > 1e-12 && out_noise_power > 1e-12 {
        10.0 * (in_noise_power / out_noise_power).log10()
    } else {
        0.0
    };

    // Phase delay at control frequency (30 Hz)
    let eval_f = 30.0;
    let mut total_phase = 0.0;
    for &nf in &notch_freqs {
        let (_, p) = notch_response(nf, bw, sample_rate, eval_f);
        total_phase += p;
    }
    if lpf_hz > 0.0 {
        let (_, lp) = lpf_response(lpf_hz, sample_rate, eval_f);
        total_phase += lp;
    }
    let delay_s = -total_phase / (2.0 * std::f64::consts::PI * eval_f);
    let delay_ms = (delay_s * 1000.0).max(0.0);

    FilterSimResult {
        noise_attenuation_db: (attenuation_db * 10.0).round() / 10.0,
        phase_delay_at_30hz_ms: (delay_ms * 10.0).round() / 10.0,
    }
}

/// Main entry point for log_filter_review calculation from log bytes.
pub fn filter_review_bytes(
    bytes: &[u8],
    axis: Option<&str>,
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let formats = parse_formats(bytes);
    if formats.is_empty() {
        return json!({ "ok": false, "error": "No message format headers found in log" });
    }

    let mut parms: BTreeMap<String, f64> = BTreeMap::new();
    let mut ftn_freqs = Vec::new();
    let mut ftn_snrs = Vec::new();
    let mut throttles = Vec::new();
    let mut rpms = Vec::new();
    let mut rate_gyr = Vec::new();
    let mut first_tho_us = 0u64;
    let mut last_tho_us = 0u64;

    let axis_filter = axis.unwrap_or("all").to_ascii_lowercase();

    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }

        if fmt.name == "PARM" {
            if let (Some(name), Some(val)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                if name.starts_with("INS_HNTCH_") || name.starts_with("INS_HNTC2_") || name.starts_with("INS_GYRO_FILTER") {
                    parms.insert(name, val);
                }
            }
        } else if fmt.name == "FTN1" || fmt.name == "FTN2" {
            if let Some(freq) = field_f64(fmt, values, "PkAvg")
                .or_else(|| field_f64(fmt, values, "Freq"))
                .or_else(|| field_f64(fmt, values, "NF"))
            {
                if freq > 30.0 && freq < 600.0 {
                    let snr = field_f64(fmt, values, "SnrAvg").unwrap_or(10.0);
                    ftn_freqs.push((us, freq));
                    ftn_snrs.push(snr);
                }
            }
        } else if fmt.name == "CTUN" {
            if let Some(tho) = field_f64(fmt, values, "ThO") {
                if tho > 0.05 && tho < 0.95 {
                    if first_tho_us == 0 {
                        first_tho_us = us;
                    }
                    last_tho_us = us;
                    throttles.push((us, tho));
                }
            }
        } else if fmt.name == "ESC" {
            if let Some(rpm) = field_f64(fmt, values, "RPM") {
                if rpm > 500.0 {
                    rpms.push((us, rpm));
                }
            }
        } else if fmt.name == "RATE" {
            let col = match axis_filter.as_str() {
                "pitch" => "P",
                "yaw" => "Y",
                _ => "R",
            };
            if let Some(val) = field_f64(fmt, values, col) {
                rate_gyr.push((us, val));
            }
        }
    }, &mut incomplete);

    // If batch gyro sampling is present, run gyro_batch_fft to get exact spectral envelope
    let scan = scan_gyro(bytes);
    let views = classify_captures(&scan.groups);

    let (sample_hz, spectrum, detected_peak_hz, _detected_snr) = if !views.is_empty() {
        let primary = &views[0];
        let rate = primary["sample_hz"].as_f64().unwrap_or(1000.0);
        let peak = primary["fundamental_hz"].as_f64().unwrap_or(0.0);
        let amp = primary["fundamental_amplitude"].as_f64().unwrap_or(0.0);
        let mut spec = Vec::new();
        if let Some(env) = primary["envelope"].as_array() {
            let res = primary["resolution_hz"].as_f64().unwrap_or(1.0);
            for (idx, val) in env.iter().enumerate() {
                if let Some(v) = val.as_f64() {
                    spec.push((idx as f64 * res, v));
                }
            }
        }
        (rate, spec, peak, amp)
    } else if !ftn_freqs.is_empty() {
        // Construct spectrum from in-flight FFT tracking (FTN1)
        let mean_freq = ftn_freqs.iter().map(|f| f.1).sum::<f64>() / ftn_freqs.len() as f64;
        let mean_snr = if ftn_snrs.is_empty() { 15.0 } else { ftn_snrs.iter().sum::<f64>() / ftn_snrs.len() as f64 };
        let mut spec = Vec::new();
        for f in (20..500).step_by(5) {
            let f_f64 = f as f64;
            let dist = (f_f64 - mean_freq).abs();
            let amp = (-dist * dist / 200.0).exp();
            spec.push((f_f64, amp));
        }
        (1000.0, spec, mean_freq, mean_snr)
    } else if rate_gyr.len() > 64 {
        // Fast FFT from RATE message gyro field
        let n = next_pow2(rate_gyr.len().min(4096));
        let mut dts: Vec<f64> = rate_gyr.windows(2).map(|w| (w[1].0.saturating_sub(w[0].0)) as f64 / 1_000_000.0).filter(|d| *d > 0.0).collect();
        dts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let dt = if dts.is_empty() { 0.0025 } else { dts[dts.len() / 2] };
        let s_rate = 1.0 / dt;
        let mut re = vec![0.0f64; n];
        let mut im = vec![0.0f64; n];
        let mean = rate_gyr[..n].iter().map(|s| s.1).sum::<f64>() / n as f64;
        for (i, item) in rate_gyr[..n].iter().enumerate() {
            let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
            re[i] = (item.1 - mean) * w;
        }
        fft(&mut re, &mut im, false);
        let mut spec = Vec::new();
        let mut best_hz = 0.0;
        let mut best_amp = 0.0;
        let res = s_rate / n as f64;
        for i in 1..(n / 2) {
            let f = i as f64 * res;
            let a = (re[i] * re[i] + im[i] * im[i]).sqrt() / n as f64;
            spec.push((f, a));
            if f >= 35.0 && f <= 450.0 && a > best_amp {
                best_amp = a;
                best_hz = f;
            }
        }
        (s_rate, spec, best_hz, best_amp)
    } else {
        return json!({
            "ok": false,
            "error": "No gyro vibration data found in log. Enable batch logging (INS_LOG_BAT_OPT=1 or 2) or ensure RATE/FTN1 messages are recorded."
        });
    };

    // Calculate hover throttle if available
    let hover_tho = if throttles.is_empty() {
        0.30
    } else {
        let mut sorted_tho: Vec<f64> = throttles.iter().map(|t| t.1).collect();
        sorted_tho.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        sorted_tho[sorted_tho.len() / 2]
    };

    // Current parameters
    let cur_enable = parms.get("INS_HNTCH_ENABLE").copied().unwrap_or(0.0) as u32;
    let cur_mode = parms.get("INS_HNTCH_MODE").copied().unwrap_or(0.0) as u32;
    let cur_freq = parms.get("INS_HNTCH_FREQ").copied().unwrap_or(0.0);
    let cur_bw = parms.get("INS_HNTCH_BW").copied().unwrap_or(0.0);
    let cur_hmncs = parms.get("INS_HNTCH_HMNCS").copied().unwrap_or(1.0) as u32;
    let cur_ref = parms.get("INS_HNTCH_REF").copied().unwrap_or(0.0);
    let cur_gyro_filter = parms.get("INS_GYRO_FILTER").copied().unwrap_or(20.0);

    // Recommended parameters
    let rec_freq = if detected_peak_hz > 30.0 { detected_peak_hz.round() } else { 120.0 };
    let rec_bw = (rec_freq * 0.5).round().max(20.0);
    let rec_hmncs: u32 = 3; // 1st and 2nd harmonic
    let rec_mode: u32 = if !rpms.is_empty() {
        3 // RPM based
    } else {
        1 // Throttle based
    };
    let rec_ref = if rec_mode == 1 { (hover_tho * 100.0).round() / 100.0 } else { 0.0 };
    let rec_gyro_filter = if rec_freq > 150.0 { 40.0 } else { 30.0 };

    // Simulate current vs proposed filter
    let cur_sim = simulate_filter(cur_freq, cur_bw, cur_hmncs, cur_gyro_filter, sample_hz, &spectrum);
    let prop_sim = simulate_filter(rec_freq, rec_bw, rec_hmncs, rec_gyro_filter, sample_hz, &spectrum);

    let needs_update = cur_enable == 0
        || (cur_freq - rec_freq).abs() > 25.0
        || (cur_bw - rec_bw).abs() > 20.0
        || cur_mode != rec_mode;

    let assessment = if cur_enable == 0 {
        format!(
            "Harmonic notch filter is disabled. Detected motor noise peak at {:.1} Hz. Enabling notch filter will reduce gyro noise by {:.1} dB with only {:.1} ms delay.",
            rec_freq, prop_sim.noise_attenuation_db, prop_sim.phase_delay_at_30hz_ms
        )
    } else if needs_update {
        format!(
            "Current notch is configured for {:.1} Hz (BW {:.1} Hz), but the actual motor vibration peak is at {:.1} Hz. Updating parameters increases noise attenuation from {:.1} dB to {:.1} dB.",
            cur_freq, cur_bw, rec_freq, cur_sim.noise_attenuation_db, prop_sim.noise_attenuation_db
        )
    } else {
        format!(
            "Harmonic notch is well-tuned! Current peak {:.1} Hz matches configured notch ({:.1} Hz). Attenuation: {:.1} dB, phase delay: {:.1} ms.",
            detected_peak_hz, cur_freq, cur_sim.noise_attenuation_db, cur_sim.phase_delay_at_30hz_ms
        )
    };

    let mut proposed_params = BTreeMap::new();
    proposed_params.insert("INS_HNTCH_ENABLE".to_string(), json!(1));
    proposed_params.insert("INS_HNTCH_MODE".to_string(), json!(rec_mode));
    proposed_params.insert("INS_HNTCH_FREQ".to_string(), json!(rec_freq));
    proposed_params.insert("INS_HNTCH_BW".to_string(), json!(rec_bw));
    proposed_params.insert("INS_HNTCH_HMNCS".to_string(), json!(rec_hmncs));
    if rec_mode == 1 {
        proposed_params.insert("INS_HNTCH_REF".to_string(), json!(rec_ref));
    }
    proposed_params.insert("INS_GYRO_FILTER".to_string(), json!(rec_gyro_filter));

    let chart_end = if last_tho_us > first_tho_us { (first_tho_us + 10_000_000).min(last_tho_us) } else { first_tho_us + 10_000_000 };
    let suggested_chart = json!({
        "title": "Throttle Profile for Notch Tracking",
        "start_us": first_tho_us,
        "end_us": chart_end,
        "axes": [{
            "label": "Throttle (0..1)",
            "lines": [
                { "message": "CTUN", "field": "ThO", "name": "Throttle Output" }
            ]
        }]
    });

    json!({
        "ok": true,
        "hover_interval": {
            "start_us": first_tho_us,
            "end_us": last_tho_us
        },
        "suggested_chart": suggested_chart,
        "sample_rate_hz": (sample_hz * 10.0).round() / 10.0,
        "primary_peak_hz": (detected_peak_hz * 10.0).round() / 10.0,
        "estimated_hover_throttle": (hover_tho * 100.0).round() / 100.0,
        "current_params": {
            "INS_HNTCH_ENABLE": cur_enable,
            "INS_HNTCH_MODE": cur_mode,
            "INS_HNTCH_FREQ": cur_freq,
            "INS_HNTCH_BW": cur_bw,
            "INS_HNTCH_HMNCS": cur_hmncs,
            "INS_HNTCH_REF": cur_ref,
            "INS_GYRO_FILTER": cur_gyro_filter
        },
        "proposed_params": Value::Object(proposed_params.into_iter().map(|(k, v)| (k, v)).collect()),
        "simulation": {
            "current_attenuation_db": cur_sim.noise_attenuation_db,
            "current_phase_delay_ms": cur_sim.phase_delay_at_30hz_ms,
            "proposed_attenuation_db": prop_sim.noise_attenuation_db,
            "proposed_phase_delay_ms": prop_sim.phase_delay_at_30hz_ms
        },
        "needs_update": needs_update,
        "assessment": assessment
    })
}

/// Public API called by agent or catalog.
pub fn filter_review(
    id: &str,
    axis: Option<&str>,
    start_us: Option<u64>,
    end_us: Option<u64>,
) -> Value {
    let bytes = match read_id(id) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    filter_review_bytes(&bytes, axis, start_us, end_us)
}
