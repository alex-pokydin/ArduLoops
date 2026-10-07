// Desired/actual tracking, step fit, and frequency response.
// The track `note` is the field-by-field reading. One fact per line. A child is indented under its parent.

macro_rules! note {
    ($($line:literal),+ $(,)?) => {
        concat!($($line, "\n"),+)
    };
}

struct TrackRow {
    us: u64,
    desired: f64,
    actual: f64,
    p: Option<f64>,
    i: Option<f64>,
    d: Option<f64>,
    ff: Option<f64>,
    dmod: Option<f64>,
    output: Option<f64>,
}

fn track_bytes(bytes: &[u8], message: &str, field: &str, start_us: Option<u64>, end_us: Option<u64>) -> Value {
    if let Some(error) = missing_message(message) {
        return error;
    }
    let formats = parse_formats(bytes);
    let Some(fmt) = formats.values().find(|fmt| fmt.name.eq_ignore_ascii_case(message)) else {
        return json!({ "ok": false, "error": "message is not in this log" });
    };
    let (actual_name, desired_name) = match track_labels(&fmt.labels, field) {
        Ok(names) => names,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let wanted = fmt.name.clone();
    let mut rows = Vec::new();
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name != wanted {
            return;
        }
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|start| us < start) || end_us.is_some_and(|end| us > end) {
            return;
        }
        let Some(desired) = field_f64(fmt, values, &desired_name) else { return };
        let Some(actual) = field_f64(fmt, values, &actual_name) else { return };
        if !desired.is_finite() || !actual.is_finite() {
            return;
        }
        let pid = fmt.labels.iter().any(|label| label == "Tar") && fmt.labels.iter().any(|label| label == "Act");
        let term = |name: &str| {
            if !pid || name == actual_name || name == desired_name {
                return None;
            }
            field_f64(fmt, values, name).filter(|n| n.is_finite())
        };
        let out_name = format!("{actual_name}Out");
        let output = field_f64(fmt, values, &out_name).filter(|n| n.is_finite());
        rows.push(TrackRow { us, desired, actual, p: term("P"), i: term("I"), d: term("D"), ff: term("FF"), dmod: term("Dmod"), output });
    }, &mut incomplete);
    if rows.is_empty() {
        return json!({ "ok": true, "op": "track", "count": 0, "note": "No finite samples in the requested interval." });
    }
    let heading = is_heading(&actual_name);
    let mut out = track_rows(&rows, heading);
    let units = column_units(bytes, &wanted);
    out["actual_unit"] = units.get(&actual_name).cloned().map(Value::String).unwrap_or(Value::Null);
    out["desired_unit"] = units.get(&desired_name).cloned().map(Value::String).unwrap_or(Value::Null);
    out["actual"] = json!(actual_name);
    out["desired"] = json!(desired_name);
    out["tail_incomplete"] = json!(incomplete);
    out
}

fn is_heading(actual: &str) -> bool {
    matches!(actual, "Roll" | "Pitch" | "Yaw")
}

fn arc_error(desired: f64, actual: f64, heading: bool) -> f64 {
    let mut error = actual - desired;
    if heading {
        while error > 180.0 {
            error -= 360.0;
        }
        while error < -180.0 {
            error += 360.0;
        }
    }
    error
}

fn track_rows(rows: &[TrackRow], heading: bool) -> Value {
    let n = rows.len() as f64;
    let wrapped = if heading {
        rows.iter().filter(|row| (row.actual - row.desired).abs() > 180.0).count()
    } else {
        0
    };
    let error_rms = (rows.iter().map(|row| {
        let error = arc_error(row.desired, row.actual, heading);
        error * error
    }).sum::<f64>() / n).sqrt();
    let peak = rows.iter().max_by(|a, b| {
        arc_error(a.desired, a.actual, heading).abs().partial_cmp(&arc_error(b.desired, b.actual, heading).abs()).unwrap_or(std::cmp::Ordering::Equal)
    }).unwrap();
    let max_abs = rows.iter().map(|row| row.desired.abs()).fold(0.0, f64::max);
    let (active_count, active_rms) = active_error(rows, max_abs, heading);
    let past = rows.iter().filter(|row| same_dir(row.desired, row.actual) && row.desired.abs() >= 0.5 * max_abs).max_by(|a, b| {
        let excess = |row: &TrackRow| row.actual.abs() - row.desired.abs();
        excess(a).partial_cmp(&excess(b)).unwrap_or(std::cmp::Ordering::Equal)
    }).filter(|row| row.actual.abs() > row.desired.abs());
    let past_command = past.map(|row| {
        let mut point = track_point(row, None);
        point["excess"] = json!(round1(row.actual.abs() - row.desired.abs()));
        point
    }).unwrap_or(Value::Null);
    let release = release_row(rows).map(|(row, command)| {
        let mut point = track_point(row, Some(command));
        let (delay, already) = step_delay_s(rows, command);
        point["delay_s"] = delay.map(|seconds| json!(round3(seconds))).unwrap_or(Value::Null);
        point["already_at_half"] = json!(already);
        let motion = release_motion(rows, command, heading);
        point["crossings"] = json!(motion.crossings);
        point["error_span"] = json!(round1(motion.error_span));
        point["actual_from"] = json!(round1(motion.actual_from));
        point["actual_to"] = json!(round1(motion.actual_to));
        point
    });
    let mut peak_error = track_point(peak, None);
    peak_error["error"] = json!(round1(arc_error(peak.desired, peak.actual, heading)));
    peak_error["opposite_sign"] = json!(opposite_sign(peak.desired, peak.actual));
    let shape = shape_of(rows, heading);
    let p_rms = term_rms(rows, |row| row.p);
    let i_rms = term_rms(rows, |row| row.i);
    let d_rms = term_rms(rows, |row| row.d);
    let ff_rms = term_rms(rows, |row| row.ff);
    let (p_share, i_share, d_share, ff_share) = term_shares(p_rms, i_rms, d_rms, ff_rms);
    let (error_peak_hz, error_peak_share) = error_tone(rows, heading);
    let (hold_count, holds) = hold_list(rows, heading);
    let out = json!({
        "ok": true,
        "op": "track",
        "count": rows.len(),
        "sample_hz": sample_hz_of(rows),
        "circular": heading,
        "wrapped_samples": wrapped,
        "error_rms": round_meas(error_rms),
        "max_abs_desired": round1(max_abs),
        "active_count": active_count,
        "active_error_rms": round_meas(active_rms),
        "peak_error": peak_error,
        "past_command": past_command,
        "release": release.unwrap_or(Value::Null),
        "step": step_of(rows),
        "hold_count": hold_count,
        "holds": holds,
        "sides": sides_of(rows, heading, max_abs),
        "error_p95": round_meas(percentile_abs(rows, heading, 0.95)),
        "corr": shape.0,
        "spread": shape.1,
        "p_rms": p_rms,
        "i_rms": i_rms,
        "d_rms": d_rms,
        "ff_rms": ff_rms,
        "p_share": p_share,
        "i_share": i_share,
        "d_share": d_share,
        "ff_share": ff_share,
        "error_peak_hz": error_peak_hz,
        "error_peak_share": error_peak_share,
        "dmod_min": dmod_ends(rows).0,
        "dmod_mean": dmod_ends(rows).1,
        "lag_s": pair_lag(rows, heading),
        "output_abs_max": output_span(rows).0,
        "output_abs_p95": output_span(rows).1,
        "output_at_peak": output_span(rows).2,
        "note": note!(
            "Every number here is this interval only. None of them names a parameter.",
            "An interval with more than one mode stretch does not describe one of those stretches.",
            "`sample_hz` is the median rate of these rows. Faster motion is not resolved.",
            "`actual` and `desired` are the columns. `desired` is the command recorded here, not the controller that formed it.",
            "`actual_unit` and `desired_unit` are the units the log recorded. Null means the log named no unit.",
            "`error` = `actual` - `desired` on the same row.",
            "  On Roll, Pitch, and Yaw the error is the short arc. `circular` is true, and `wrapped_samples` is how many rows crossed 0°. A step across 0° is a small error. Rate columns stay linear.",
            "`error_rms` = rms(`error`) over every sample. A moving command makes this the following error, not the error of a hold. A small value does not say the loop is tuned.",
            "`error_p95` = percentile_95(|`error`|). It is not a limit.",
            "`max_abs_desired` is the largest absolute command here.",
            "`active_count` counts samples with |`desired`| >= 0.25 * `max_abs_desired`. `active_error_rms` = rms(`error`) on those samples.",
            "`corr` is whether desired and actual share a shape. It leaves out amplitude, lag, and the size of the error.",
            "  A modest `corr` beside a small `error_rms` is a hold.",
            "  Actual contains motion that desired does not.",
            "  Near zero or below, the columns do not share one shape. Noise can do that. It does not say this loop is the weakest. The outer loop is its own track.",
            "  When desired barely moves, `corr` is not a comparison with another loop. On a heading that crossed 0°, `corr` and `spread` are null.",
            "`spread` = std(`actual`) / std(`desired`).",
            "  It is not a percent.",
            "  Above 1 means actual varied more than desired. Below 1 means less.",
            "  That difference of variation is not a frequency, not an overshoot, not damping, and not a gain.",
            "  It does not say why actual varied more, and it does not name a parameter.",
            "`lag_s` is the whole-sample shift of `sample_hz` that lines the columns up. Positive takes actual from a later row.",
            "  The sentence is that the columns line up at this shift.",
            "  It is not the delay of the controller, and it is not `group_delay_s`.",
            "  Within one sample of zero is the resolution of that shift. It does not say the delay is zero.",
            "  Null means the command barely moves or the heading crossed 0°.",
            "`peak_error` is the row with the largest absolute error.",
            "  `error` is actual minus desired on that row.",
            "  `opposite_sign` means both were nonzero and had different signs.",
            "`past_command` is the one row where actual ran furthest past desired, same sign, while desired was still at least half its largest absolute value.",
            "  `excess` = |`actual`| - |`desired`| on that row.",
            "  Null means no such row. It is not an excess of zero.",
            "  Actual can still be past a command that has already fallen.",
            "`release` is the largest actual left in the half-second after desired fell below a quarter of its own peak.",
            "  `command` is that peak. `delay_s` is the time from its rise until actual first reached half of it, same sign. It is that command only.",
            "  Null with `already_at_half` true means actual was already past half. False means it did not reach half within a second.",
            "  `crossings` counts sign changes of the error in that half-second. `error_span` is the largest error minus the smallest. `actual_from` and `actual_to` are actual at the start and end.",
            "`output_abs_max` and `output_abs_p95` are the absolute output beside actual, such as ROut beside R. `output_at_peak` is the share of samples at that maximum.",
            "  The maximum is inside this interval, not a stored limit. Null means no such column.",
            "`step` is the fit of one command that held. `zeta`, `wn_hz`, and `fit_rms` are that fit. `fit_rms` is the residual.",
            "  Null means the command did not hold, the residual was large, or the frequency sat on the edge of the search. An edge frequency is not identified.",
            "`hold_count` is how many times the command changed and then stayed.",
            "`holds` lists those changes, at most ten, in time order. Further ones keep those that were steady before and held longest. The entries are not an average.",
            "  Shorter than three samples, or shorter than 0.15 s, is not an entry. An empty list and a count of zero mean no such command.",
            "  `from` is the level before. `command` is the new level. `hold_s` is how long it stayed.",
            "  `overshoot` = max(0, sign(`command` - `from`) * (`actual` - `command`)). `reached` is true once actual has covered 0.9 of the step.",
            "  `zeta`, `wn_hz`, and `fit_rms` appear only when the level before was steady for 0.15 s and the fit identified the hold.",
            "`sides` uses the samples in `active_count` where `actual` and `desired` have the same sign.",
            "  `beyond` = |`actual`| - |`desired`|, where that is positive.",
            "  `short` = |`desired`| - |`actual`|, where actual is closer. `actual` = 0 gives |`desired`|.",
            "  Opposite signs and an exact match are on neither side, so the shares can sum to less than 1.",
            "  A null `sides` means the command never reached a quarter of its largest value, or the columns are a heading.",
            "  Each side has `count`, `share`, `mean`, and `p95`.",
            "    `count` is how many samples landed there.",
            "    `share` = `count` / `active_count`.",
            "    `mean` = sum(gaps) / `count`, in the column units.",
            "    `p95` = percentile_95(gaps).",
            "    No samples on a side leaves `mean` and `p95` null.",
            "`p_rms`, `i_rms`, `d_rms`, and `ff_rms` are the PID terms when the message has Tar and Act.",
            "  Null means that column is absent. Zero means the column was present and zero. A small `i_rms` on a short interval does not say I is missing.",
            "  `p_share` = `p_rms`^2 / (`p_rms`^2 + `i_rms`^2 + `d_rms`^2 + `ff_rms`^2), and the same for `i_share`, `d_share`, and `ff_share`, using the terms present. The shares add to 1. A share is not a cause.",
            "  A large `d_share` is the D column following faster changes, including noise.",
            "  It is not evidence that D is high, and it is not a reason to change D.",
            "  A column named P on a rate row is not the P term. The separate maximum of each column is not these rows.",
            "`dmod_min` below 1 means D was reduced on at least one sample. 1 means it was not.",
            "`error_peak_hz` is the loudest frequency of the error after the mean is removed.",
            "  `error_peak_share` is that bin's fraction of the spectrum. Near 1 is one tone. A small share is spread across frequencies.",
            "  Null means fewer than 16 samples or more than 8192. It is not a motor harmonic.",
        ),
    });
    out
}

fn percentile_abs(rows: &[TrackRow], heading: bool, p: f64) -> f64 {
    let mut values: Vec<f64> = rows.iter().map(|row| arc_error(row.desired, row.actual, heading).abs()).collect();
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((p * values.len() as f64).ceil() as usize).saturating_sub(1).min(values.len() - 1);
    values[rank]
}

fn shape_of(rows: &[TrackRow], heading: bool) -> (Option<f64>, Option<f64>) {
    let wrapped = heading && rows.iter().any(|row| (row.actual - row.desired).abs() > 180.0);
    if wrapped || rows.len() < 2 {
        return (None, None);
    }
    let n = rows.len() as f64;
    let mean_d = rows.iter().map(|row| row.desired).sum::<f64>() / n;
    let mean_a = rows.iter().map(|row| row.actual).sum::<f64>() / n;
    let mut num = 0.0;
    let mut dev_d = 0.0;
    let mut dev_a = 0.0;
    for row in rows {
        let xd = row.desired - mean_d;
        let xa = row.actual - mean_a;
        num += xd * xa;
        dev_d += xd * xd;
        dev_a += xa * xa;
    }
    if dev_d < 1e-9 {
        return (None, None);
    }
    let corr = if dev_a < 1e-9 { Some(0.0) } else { Some((num / (dev_d * dev_a).sqrt() * 1000.0).round() / 1000.0) };
    let spread = Some(((dev_a / dev_d).sqrt() * 100.0).round() / 100.0);
    (corr, spread)
}

fn term_rms(rows: &[TrackRow], pick: impl Fn(&TrackRow) -> Option<f64>) -> Option<f64> {
    let values: Vec<f64> = rows.iter().filter_map(&pick).collect();
    if values.is_empty() {
        return None;
    }
    let mean = values.iter().map(|value| value * value).sum::<f64>() / values.len() as f64;
    Some(round_d(mean.sqrt()))
}

fn term_shares(p: Option<f64>, i: Option<f64>, d: Option<f64>, ff: Option<f64>) -> (Value, Value, Value, Value) {
    let present = [p, i, d, ff];
    let sum: f64 = present.into_iter().flatten().map(|value| value * value).sum();
    if sum < 1e-18 {
        return (Value::Null, Value::Null, Value::Null, Value::Null);
    }
    let share = |value: Option<f64>| value.map(|value| json!((value * value / sum * 1000.0).round() / 1000.0)).unwrap_or(Value::Null);
    (share(p), share(i), share(d), share(ff))
}

fn error_tone(rows: &[TrackRow], heading: bool) -> (Value, Value) {
    if !(16..=8192).contains(&rows.len()) {
        return (Value::Null, Value::Null);
    }
    let mut dts: Vec<f64> = rows.windows(2).filter_map(|pair| {
        let dt = pair[1].us.saturating_sub(pair[0].us) as f64 / 1_000_000.0;
        (dt > 0.0).then_some(dt)
    }).collect();
    if dts.len() < 8 {
        return (Value::Null, Value::Null);
    }
    dts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dt = dts[dts.len() / 2];
    if dt <= 0.0 || dt > 0.5 {
        return (Value::Null, Value::Null);
    }
    let n = next_pow2(rows.len()).max(16);
    if n > 8192 {
        return (Value::Null, Value::Null);
    }
    let errors: Vec<f64> = rows.iter().map(|row| arc_error(row.desired, row.actual, heading)).collect();
    let mean = errors.iter().sum::<f64>() / errors.len() as f64;
    let mut re = vec![0.0; n];
    let mut im = vec![0.0; n];
    let len = errors.len() as f64;
    for (i, error) in errors.iter().enumerate() {
        let window = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / len).cos();
        re[i] = (error - mean) * window;
    }
    fft(&mut re, &mut im, false);
    let mut peak_i = 1usize;
    let mut peak = 0.0;
    let mut total = 0.0;
    for i in 1..n / 2 {
        let power = re[i] * re[i] + im[i] * im[i];
        total += power;
        if power > peak {
            peak = power;
            peak_i = i;
        }
    }
    if total < 1e-18 {
        return (Value::Null, Value::Null);
    }
    let hz = ((1.0 / dt) * peak_i as f64 / n as f64 * 10.0).round() / 10.0;
    let share = (peak / total * 1000.0).round() / 1000.0;
    (json!(hz), json!(share))
}

fn median_dt_s(rows: &[TrackRow]) -> Option<f64> {
    let mut dts: Vec<f64> = rows.windows(2).filter_map(|pair| {
        let dt = pair[1].us.saturating_sub(pair[0].us) as f64 / 1_000_000.0;
        (dt > 0.0).then_some(dt)
    }).collect();
    if dts.is_empty() {
        return None;
    }
    dts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dt = dts[dts.len() / 2];
    (dt > 0.0 && dt <= 0.5).then_some(dt)
}

fn sample_hz_of(rows: &[TrackRow]) -> Value {
    median_dt_s(rows).map(|dt| json!(round1(1.0 / dt))).unwrap_or(Value::Null)
}

fn pair_lag(rows: &[TrackRow], heading: bool) -> Option<f64> {
    if rows.len() < 8 || (heading && rows.iter().any(|row| (row.actual - row.desired).abs() > 180.0)) {
        return None;
    }
    let mut dts: Vec<f64> = rows.windows(2).filter_map(|pair| {
        let dt = pair[1].us.saturating_sub(pair[0].us) as f64 / 1_000_000.0;
        (dt > 0.0).then_some(dt)
    }).collect();
    if dts.is_empty() {
        return None;
    }
    dts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dt = dts[dts.len() / 2];
    if dt <= 0.0 || dt > 0.5 {
        return None;
    }
    let desired: Vec<f64> = rows.iter().map(|row| row.desired).collect();
    let mean_d = desired.iter().sum::<f64>() / desired.len() as f64;
    if desired.iter().map(|value| (value - mean_d).powi(2)).sum::<f64>() < 1e-9 {
        return None;
    }
    let max_shift = ((1.0 / dt) as usize).min(rows.len() / 4).max(1);
    let mut best_k = 0isize;
    let mut best = f64::NEG_INFINITY;
    for shift in -(max_shift as isize)..=(max_shift as isize) {
        let score = corr_at(&desired, rows, shift);
        if score > best {
            best = score;
            best_k = shift;
        }
    }
    best.is_finite().then(|| (best_k as f64 * dt * 1000.0).round() / 1000.0)
}

fn corr_at(desired: &[f64], rows: &[TrackRow], shift: isize) -> f64 {
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for (index, desired_value) in desired.iter().enumerate() {
        let at = index as isize + shift;
        if at < 0 || at >= rows.len() as isize {
            continue;
        }
        xs.push(*desired_value);
        ys.push(rows[at as usize].actual);
    }
    if xs.len() < 8 {
        return f64::NEG_INFINITY;
    }
    let n = xs.len() as f64;
    let mean_x = xs.iter().sum::<f64>() / n;
    let mean_y = ys.iter().sum::<f64>() / n;
    let mut num = 0.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for (x, y) in xs.iter().zip(&ys) {
        let a = x - mean_x;
        let b = y - mean_y;
        num += a * b;
        dx += a * a;
        dy += b * b;
    }
    if dx < 1e-9 || dy < 1e-9 { f64::NEG_INFINITY } else { num / (dx * dy).sqrt() }
}

fn output_span(rows: &[TrackRow]) -> (Option<f64>, Option<f64>, Option<f64>) {
    let values: Vec<f64> = rows.iter().filter_map(|row| row.output).map(|value| value.abs()).collect();
    if values.is_empty() {
        return (None, None, None);
    }
    let mut sorted = values.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((0.95 * sorted.len() as f64).ceil() as usize).saturating_sub(1).min(sorted.len() - 1);
    let max = sorted[sorted.len() - 1];
    let share = if max < 1e-6 {
        None
    } else {
        let at_peak = values.iter().filter(|value| **value >= max * 0.99).count();
        Some((at_peak as f64 / values.len() as f64 * 1000.0).round() / 1000.0)
    };
    (Some(round1(max)), Some(round1(sorted[rank])), share)
}

fn dmod_ends(rows: &[TrackRow]) -> (Option<f64>, Option<f64>) {
    let values: Vec<f64> = rows.iter().filter_map(|row| row.dmod).collect();
    if values.is_empty() {
        return (None, None);
    }
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    (Some(round_d(min)), Some(round_d(mean)))
}

fn active_error(rows: &[TrackRow], max_abs: f64, heading: bool) -> (usize, f64) {
    let floor = 0.25 * max_abs;
    let errors: Vec<f64> = rows.iter().filter(|row| row.desired.abs() >= floor).map(|row| {
        let error = arc_error(row.desired, row.actual, heading);
        error * error
    }).collect();
    if errors.is_empty() {
        return (0, 0.0);
    }
    let rms = (errors.iter().sum::<f64>() / errors.len() as f64).sqrt();
    (errors.len(), rms)
}

fn step_delay_s(rows: &[TrackRow], command: &TrackRow) -> (Option<f64>, bool) {
    let peak = command.desired.abs();
    if peak == 0.0 {
        return (None, false);
    }
    let half = 0.5 * peak;
    let Some(cmd_i) = rows.iter().position(|row| std::ptr::eq(row, command)) else { return (None, false) };
    let mut start_i = cmd_i;
    for j in (0..cmd_i).rev() {
        if rows[j].desired.abs() < half {
            start_i = j + 1;
            break;
        }
        start_i = 0;
    }
    let start_us = rows[start_i].us;
    let limit = command.us.saturating_add(1_000_000);
    match rows[start_i..].iter().find(|row| row.us <= limit && row.actual.abs() >= half && same_dir(command.desired, row.actual)) {
        Some(row) if row.us == start_us => (None, true),
        Some(row) => (Some(row.us.saturating_sub(start_us) as f64 / 1_000_000.0), false),
        None => (None, false),
    }
}

struct ReleaseMotion {
    crossings: u32,
    error_span: f64,
    actual_from: f64,
    actual_to: f64,
}

fn release_motion(rows: &[TrackRow], command: &TrackRow, heading: bool) -> ReleaseMotion {
    let quarter = 0.25 * command.desired.abs();
    let cmd_i = rows.iter().position(|row| std::ptr::eq(row, command)).unwrap_or(0);
    let mut fell: Option<u64> = None;
    let mut prev_err: Option<f64> = None;
    let mut crossings = 0u32;
    let mut error_min = f64::INFINITY;
    let mut error_max = f64::NEG_INFINITY;
    let mut actual_from = None;
    let mut actual_to = command.actual;
    for row in &rows[cmd_i + 1..] {
        if fell.is_none() {
            if row.us.saturating_sub(command.us) > 1_000_000 {
                break;
            }
            if row.desired.abs() >= quarter {
                continue;
            }
            fell = Some(row.us);
        }
        if row.us.saturating_sub(fell.unwrap_or(row.us)) > 500_000 || row.desired.abs() >= quarter {
            break;
        }
        let err = arc_error(row.desired, row.actual, heading);
        error_min = error_min.min(err);
        error_max = error_max.max(err);
        if actual_from.is_none() {
            actual_from = Some(row.actual);
        }
        actual_to = row.actual;
        if let Some(prev) = prev_err {
            if prev * err < 0.0 {
                crossings += 1;
            }
        }
        prev_err = Some(err);
    }
    ReleaseMotion {
        crossings,
        error_span: if error_min.is_finite() { error_max - error_min } else { 0.0 },
        actual_from: actual_from.unwrap_or(command.actual),
        actual_to,
    }
}

fn opposite_sign(desired: f64, actual: f64) -> bool {
    desired != 0.0 && actual != 0.0 && desired.signum() != actual.signum()
}

fn step_of(rows: &[TrackRow]) -> Value {
    let max_abs = rows.iter().map(|row| row.desired.abs()).fold(0.0, f64::max);
    if max_abs < 1e-6 {
        return Value::Null;
    }
    let floor = 0.85 * max_abs;
    let mut best: Option<(usize, usize)> = None;
    let mut run: Option<(usize, f64)> = None;
    for (i, row) in rows.iter().enumerate() {
        let sign = row.desired.signum();
        let holds = row.desired.abs() >= floor && run.is_none_or(|(_, kept)| sign == kept);
        if holds {
            if run.is_none() {
                run = Some((i, sign));
            }
        } else if let Some((start, _)) = run.take() {
            remember_run(&mut best, start, i - 1);
        }
    }
    if let Some((start, _)) = run {
        remember_run(&mut best, start, rows.len() - 1);
    }
    let Some((start, end)) = best else { return Value::Null };
    if end - start < 3 || rows[end].us.saturating_sub(rows[start].us) < 150_000 {
        return Value::Null;
    }
    let mut levels: Vec<f64> = rows[start..=end].iter().map(|row| row.desired).collect();
    levels.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let command = levels[levels.len() / 2];
    if command.abs() < 1e-6 {
        return Value::Null;
    }
    let t0 = rows[start].us;
    let samples: Vec<(f64, f64)> = rows[start..=end].iter().map(|row| {
        ((row.us.saturating_sub(t0)) as f64 / 1_000_000.0, row.actual / command)
    }).collect();
    let Some((best_zeta, best_hz, fit_rms)) = fit_normalized(&samples, command.abs()) else {
        return Value::Null;
    };
    json!({
        "t_s": (t0 as f64 / 1_000_000.0 * 100.0).round() / 100.0,
        "command": round1(command),
        "zeta": (best_zeta * 100.0).round() / 100.0,
        "wn_hz": (best_hz * 10.0).round() / 10.0,
        "fit_rms": round1(fit_rms),
    })
}

fn fit_normalized(samples: &[(f64, f64)], scale: f64) -> Option<(f64, f64, f64)> {
    if samples.len() < 4 || scale < 1e-6 {
        return None;
    }
    let mut best_cost = f64::INFINITY;
    let mut best_zeta = 0.0;
    let mut best_hz = 0.0;
    let mut hz = 1.0;
    while hz <= 16.0 {
        let mut zeta = 0.25;
        while zeta <= 0.95 {
            let wn = 2.0 * std::f64::consts::PI * hz;
            let cost: f64 = samples.iter().map(|(t, y)| {
                let err = y - step_model(*t, zeta, wn);
                err * err
            }).sum();
            if cost < best_cost {
                best_cost = cost;
                best_zeta = zeta;
                best_hz = hz;
            }
            zeta += 0.05;
        }
        hz += 0.5;
    }
    let fit_rms = (best_cost / samples.len() as f64).sqrt() * scale;
    if fit_rms > 0.35 * scale || best_hz <= 1.0 || best_hz >= 16.0 {
        return None;
    }
    Some((best_zeta, best_hz, fit_rms))
}

struct HoldEvent {
    t_us: u64,
    from: f64,
    command: f64,
    hold_us: u64,
    pre_us: u64,
    overshoot: f64,
    reached: bool,
    fit: Option<(f64, f64, f64)>,
}

fn hold_list(rows: &[TrackRow], heading: bool) -> (usize, Value) {
    let events = hold_events(rows, heading);
    let count = events.len();
    let mut ranked = events;
    ranked.sort_by(|a, b| {
        let score = |event: &HoldEvent| (event.pre_us as u128) * (event.hold_us as u128);
        score(b).cmp(&score(a)).then(b.hold_us.cmp(&a.hold_us)).then(a.t_us.cmp(&b.t_us))
    });
    ranked.truncate(10);
    ranked.sort_by_key(|event| event.t_us);
    let holds: Vec<Value> = ranked.into_iter().map(|event| {
        let (zeta, wn_hz, fit_rms) = match event.fit {
            Some((zeta, hz, rms)) => (
                json!((zeta * 100.0).round() / 100.0),
                json!((hz * 10.0).round() / 10.0),
                json!(round1(rms)),
            ),
            None => (Value::Null, Value::Null, Value::Null),
        };
        json!({
            "t_s": (event.t_us as f64 / 1_000_000.0 * 100.0).round() / 100.0,
            "from": round_meas(event.from),
            "command": round_meas(event.command),
            "hold_s": round3(event.hold_us as f64 / 1_000_000.0),
            "overshoot": round_meas(event.overshoot),
            "reached": event.reached,
            "zeta": zeta,
            "wn_hz": wn_hz,
            "fit_rms": fit_rms,
        })
    }).collect();
    (count, json!(holds))
}

fn sides_of(rows: &[TrackRow], heading: bool, max_abs: f64) -> Value {
    if heading || max_abs < 1e-9 {
        return Value::Null;
    }
    let floor = 0.25 * max_abs;
    let mut beyond = Vec::new();
    let mut short = Vec::new();
    let mut active = 0usize;
    for row in rows {
        if row.desired.abs() < floor {
            continue;
        }
        active += 1;
        let gap = row.actual.abs() - row.desired.abs();
        if row.actual != 0.0 && row.desired.signum() != row.actual.signum() {
            continue;
        }
        if gap > 0.0 {
            beyond.push(gap);
        } else if gap < 0.0 {
            short.push(-gap);
        }
    }
    if active == 0 {
        return Value::Null;
    }
    json!({
        "active_count": active,
        "beyond": side_stats(&beyond, active),
        "short": side_stats(&short, active),
    })
}

fn side_stats(values: &[f64], active: usize) -> Value {
    if values.is_empty() {
        return json!({ "count": 0, "share": 0.0, "mean": Value::Null, "p95": Value::Null });
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    json!({
        "count": values.len(),
        "share": round_meas(values.len() as f64 / active as f64),
        "mean": round_meas(mean),
        "p95": round_meas(percentile(values, 0.95)),
    })
}

fn percentile(values: &[f64], p: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((p * sorted.len() as f64).ceil() as usize).saturating_sub(1).min(sorted.len() - 1);
    sorted[rank]
}

fn hold_events(rows: &[TrackRow], heading: bool) -> Vec<HoldEvent> {
    let Some(tol) = hold_tol(rows, heading) else {
        return Vec::new();
    };
    let mut events = Vec::new();
    let mut i = 1;
    while i < rows.len() {
        let jump = arc_error(rows[i - 1].desired, rows[i].desired, heading).abs();
        if jump <= tol {
            i += 1;
            continue;
        }
        let anchor = rows[i].desired;
        let mut end = i;
        while end + 1 < rows.len() && arc_error(anchor, rows[end + 1].desired, heading).abs() <= tol {
            end += 1;
        }
        let hold_us = rows[end].us.saturating_sub(rows[i].us);
        if end - i + 1 >= 3 && hold_us >= 150_000 {
            if let Some(event) = hold_event(rows, heading, tol, i, end) {
                events.push(event);
            }
        }
        i = end + 1;
    }
    events
}

fn hold_tol(rows: &[TrackRow], heading: bool) -> Option<f64> {
    if rows.len() < 4 {
        return None;
    }
    let mut diffs: Vec<f64> = rows.windows(2).map(|pair| arc_error(pair[0].desired, pair[1].desired, heading).abs()).collect();
    diffs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = diffs[diffs.len() / 2];
    let mut positive: Vec<f64> = diffs.into_iter().filter(|diff| *diff > 1e-9).collect();
    if positive.is_empty() {
        return None;
    }
    positive.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let tol = if median > 1e-9 {
        3.0 * median
    } else if positive.len() == 1 {
        positive[0] * 0.25
    } else {
        0.5 * positive[positive.len() / 4]
    };
    (tol > 1e-9).then_some(tol)
}

fn hold_event(rows: &[TrackRow], heading: bool, tol: f64, start: usize, end: usize) -> Option<HoldEvent> {
    let (from, pre_us) = before_level(rows, heading, tol, start)?;
    let held: Vec<f64> = rows[start..=end].iter().map(|row| row.desired).collect();
    let command = level_median(&held, heading);
    let step = arc_error(from, command, heading);
    if step.abs() <= tol {
        return None;
    }
    let sign = step.signum();
    let mut overshoot = 0.0;
    let mut reached = false;
    let need = step.abs() * 0.9;
    for row in &rows[start..=end] {
        let past = arc_error(command, row.actual, heading) * sign;
        if past > overshoot {
            overshoot = past;
        }
        if arc_error(from, row.actual, heading) * sign >= need {
            reached = true;
        }
    }
    let samples: Vec<(f64, f64)> = rows[start..=end].iter().map(|row| {
        let t = row.us.saturating_sub(rows[start].us) as f64 / 1_000_000.0;
        (t, arc_error(from, row.actual, heading) / step)
    }).collect();
    let fit = (pre_us >= 150_000 && samples.len() >= 4).then(|| fit_normalized(&samples, step.abs())).flatten();
    Some(HoldEvent {
        t_us: rows[start].us,
        from,
        command,
        hold_us: rows[end].us.saturating_sub(rows[start].us),
        pre_us,
        overshoot,
        reached,
        fit,
    })
}

fn before_level(rows: &[TrackRow], heading: bool, tol: f64, hold_start: usize) -> Option<(f64, u64)> {
    if hold_start == 0 {
        return None;
    }
    let (start, end) = {
        let (near_start, near_end) = run_touching(rows, heading, tol, hold_start - 1);
        if run_us(rows, near_start, near_end) < 150_000 && near_start > 0 {
            let (far_start, far_end) = run_touching(rows, heading, tol, near_start - 1);
            if run_us(rows, far_start, far_end) >= run_us(rows, near_start, near_end) {
                (far_start, far_end)
            } else {
                (near_start, near_end)
            }
        } else {
            (near_start, near_end)
        }
    };
    let values: Vec<f64> = rows[start..=end].iter().map(|row| row.desired).collect();
    Some((level_median(&values, heading), run_us(rows, start, end)))
}

fn run_touching(rows: &[TrackRow], heading: bool, tol: f64, end: usize) -> (usize, usize) {
    let anchor = rows[end].desired;
    let mut start = end;
    while start > 0 && arc_error(anchor, rows[start - 1].desired, heading).abs() <= tol {
        start -= 1;
    }
    (start, end)
}

fn run_us(rows: &[TrackRow], start: usize, end: usize) -> u64 {
    rows[end].us.saturating_sub(rows[start].us)
}

fn level_median(values: &[f64], heading: bool) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    if !heading {
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        return sorted[sorted.len() / 2];
    }
    let origin = values[0];
    let mut arcs: Vec<f64> = values.iter().map(|value| arc_error(origin, *value, true)).collect();
    arcs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    origin + arcs[arcs.len() / 2]
}

fn remember_run(best: &mut Option<(usize, usize)>, start: usize, end: usize) {
    if end < start {
        return;
    }
    if best.is_none_or(|(kept_start, kept_end)| end - start > kept_end - kept_start) {
        *best = Some((start, end));
    }
}

fn step_model(t: f64, zeta: f64, wn: f64) -> f64 {
    let z = zeta.clamp(0.05, 0.99);
    let wd = wn * (1.0 - z * z).sqrt();
    let phi = z.acos();
    1.0 - (-z * wn * t).exp() / (1.0 - z * z).sqrt() * (wd * t + phi).sin()
}

fn frf_bytes(bytes: &[u8], message: &str, field: &str, start_us: Option<u64>, end_us: Option<u64>) -> Value {
    if let Some(error) = missing_message(message) {
        return error;
    }
    let formats = parse_formats(bytes);
    let Some(fmt) = formats.values().find(|fmt| fmt.name.eq_ignore_ascii_case(message)) else {
        return json!({ "ok": false, "error": "message is not in this log" });
    };
    let (actual_name, desired_name) = match track_labels(&fmt.labels, field) {
        Ok(names) => names,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let wanted = fmt.name.clone();
    let mut samples = Vec::new();
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name != wanted {
            return;
        }
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|start| us < start) || end_us.is_some_and(|end| us > end) {
            return;
        }
        let Some(desired) = field_f64(fmt, values, &desired_name) else { return };
        let Some(actual) = field_f64(fmt, values, &actual_name) else { return };
        if desired.is_finite() && actual.is_finite() {
            samples.push((us, desired, actual));
        }
    }, &mut incomplete);
    if is_heading(&actual_name) && samples.iter().any(|row| (row.2 - row.1).abs() > 180.0) {
        return json!({
            "ok": false,
            "error": "this pair is a heading and it crossed 0°. A linear frequency response treats that step as a huge move. track measures that error on the short arc.",
            "actual": actual_name,
            "desired": desired_name,
        });
    }
    if samples.len() < 96 {
        return json!({
            "ok": false,
            "error": "too few samples",
            "count": samples.len(),
            "note": concat!(
                "frf needs at least 96 paired samples. ",
                "The series was not shortened.",
            ),
        });
    }
    let mut dts: Vec<f64> = samples.windows(2).filter_map(|pair| {
        let dt = pair[1].0.saturating_sub(pair[0].0) as f64 / 1_000_000.0;
        (dt > 0.0).then_some(dt)
    }).collect();
    if dts.is_empty() {
        return json!({ "ok": false, "error": "sample rate is unknown" });
    }
    dts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dt = dts[dts.len() / 2];
    let rate = 1.0 / dt;
    let seg = if samples.len() >= 256 { 128 } else { 64 };
    let hop = seg / 2;
    let segments = (samples.len() - seg) / hop + 1;
    if segments < 2 {
        return json!({ "ok": false, "error": "too few samples", "count": samples.len(), "note": "frf needs at least two segments." });
    }
    let mean_d = samples.iter().map(|row| row.1).sum::<f64>() / samples.len() as f64;
    let mean_a = samples.iter().map(|row| row.2).sum::<f64>() / samples.len() as f64;
    let mut pxx = vec![0.0; seg / 2];
    let mut pyy = vec![0.0; seg / 2];
    let mut pxy_re = vec![0.0; seg / 2];
    let mut pxy_im = vec![0.0; seg / 2];
    for seg_i in 0..segments {
        let from = seg_i * hop;
        let mut x_re = vec![0.0; seg];
        let mut x_im = vec![0.0; seg];
        let mut y_re = vec![0.0; seg];
        let mut y_im = vec![0.0; seg];
        for i in 0..seg {
            let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / seg as f64).cos();
            x_re[i] = (samples[from + i].1 - mean_d) * w;
            y_re[i] = (samples[from + i].2 - mean_a) * w;
        }
        fft(&mut x_re, &mut x_im, false);
        fft(&mut y_re, &mut y_im, false);
        for k in 0..seg / 2 {
            pxx[k] += x_re[k] * x_re[k] + x_im[k] * x_im[k];
            pyy[k] += y_re[k] * y_re[k] + y_im[k] * y_im[k];
            pxy_re[k] += y_re[k] * x_re[k] + y_im[k] * x_im[k];
            pxy_im[k] += y_im[k] * x_re[k] - y_re[k] * x_im[k];
        }
    }
    let resolution = rate / seg as f64;
    let max_hz = (rate * 0.45).min(40.0);
    let mut chosen = Vec::new();
    let mut hz = resolution.max(1.0);
    while hz <= max_hz && chosen.len() < 12 {
        let bin = (hz / resolution).round() as usize;
        if (1..seg / 2).contains(&bin) && !chosen.contains(&bin) {
            chosen.push(bin);
        }
        hz += ((max_hz - 1.0) / 11.0).max(resolution);
    }
    if chosen.is_empty() {
        return json!({ "ok": false, "error": "sample rate is too low for this response", "sample_hz": round1(rate) });
    }
    let mut bins = Vec::new();
    let mut prev_phase = 0.0;
    let mut have_phase = false;
    let mut delay_w = Vec::new();
    let mut delay_p = Vec::new();
    for bin in chosen {
        let xx = pxx[bin];
        let yy = pyy[bin];
        let coherence = if xx > 1e-18 && yy > 1e-18 {
            ((pxy_re[bin] * pxy_re[bin] + pxy_im[bin] * pxy_im[bin]) / (xx * yy)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let gain = if xx > 1e-18 { (pxy_re[bin] * pxy_re[bin] + pxy_im[bin] * pxy_im[bin]).sqrt() / xx } else { 0.0 };
        let mut phase = pxy_im[bin].atan2(pxy_re[bin]);
        if have_phase {
            while phase - prev_phase > std::f64::consts::PI { phase -= 2.0 * std::f64::consts::PI; }
            while prev_phase - phase > std::f64::consts::PI { phase += 2.0 * std::f64::consts::PI; }
        }
        prev_phase = phase;
        have_phase = true;
        let bin_hz = rate * bin as f64 / seg as f64;
        if coherence >= 0.5 && bin_hz >= 1.0 && bin_hz <= 20.0 {
            delay_w.push(2.0 * std::f64::consts::PI * bin_hz);
            delay_p.push(phase);
        }
        bins.push(json!({
            "hz": round1(bin_hz),
            "gain_db": round1(if gain <= 1e-12 { -80.0 } else { (20.0 * gain.log10()).clamp(-80.0, 40.0) }),
            "phase_deg": round1(phase * 180.0 / std::f64::consts::PI),
            "coherence": round1(coherence),
        }));
    }
    let reference = bins.iter().find(|bin| bin["coherence"].as_f64().unwrap_or(0.0) >= 0.5).and_then(|bin| bin["gain_db"].as_f64());
    let bandwidth = reference.and_then(|reference| {
        bins.iter().find(|bin| {
            bin["coherence"].as_f64().unwrap_or(0.0) >= 0.4 && bin["gain_db"].as_f64().unwrap_or(0.0) <= reference - 3.0
        }).and_then(|bin| bin["hz"].as_f64())
    });
    let group_delay = if delay_w.len() >= 3 {
        let n = delay_w.len() as f64;
        let mean_w = delay_w.iter().sum::<f64>() / n;
        let mean_p = delay_p.iter().sum::<f64>() / n;
        let mut num = 0.0;
        let mut den = 0.0;
        for (w, p) in delay_w.iter().zip(delay_p.iter()) {
            num += (w - mean_w) * (p - mean_p);
            den += (w - mean_w) * (w - mean_w);
        }
        (den > 1e-12).then(|| round3(-num / den))
    } else {
        None
    };
    json!({
        "ok": true,
        "op": "frf",
        "actual": actual_name,
        "desired": desired_name,
        "count": samples.len(),
        "sample_hz": round1(rate),
        "nyquist_hz": round1(rate / 2.0),
        "resolution_hz": round1(resolution),
        "bandwidth_hz": bandwidth.map(|hz| json!(hz)).unwrap_or(Value::Null),
        "group_delay_s": group_delay.map(|seconds| json!(seconds)).unwrap_or(Value::Null),
        "bins": bins,
        "tail_incomplete": incomplete,
        "note": concat!(
            "This is the closed-loop ratio of actual to desired on the same row, for the interval that was passed. ",
            "gain_db above zero means actual was larger than desired at that frequency. ",
            "phase_deg is the phase of that same ratio. ",
            "Neither is a damping ratio, a phase margin, or a gain margin, and neither names a parameter. ",
            "coherence near zero means the bin is not a measurement. ",
            "One bin does not describe the rest of the band. ",
            "bandwidth_hz is where the gain falls 3 dB below the first coherent bin, or null if it does not. ",
            "group_delay_s is the delay of this frequency ratio where coherence stays high, or null. ",
            "It is not lag_s. ",
            "lag_s is the time shift that lines the two columns up. ",
            "A frequency above nyquist_hz is not in this log.",
        ),
    })
}

fn release_row(rows: &[TrackRow]) -> Option<(&TrackRow, &TrackRow)> {
    if rows.len() < 3 {
        return None;
    }
    let max_abs = rows.iter().map(|row| row.desired.abs()).fold(0.0, f64::max);
    if max_abs == 0.0 {
        return None;
    }
    let mut best: Option<(&TrackRow, &TrackRow, f64)> = None;
    for i in 1..rows.len() - 1 {
        let peak = rows[i].desired.abs();
        if peak < 0.5 * max_abs || peak < rows[i - 1].desired.abs() || peak <= rows[i + 1].desired.abs() {
            continue;
        }
        let quarter = 0.25 * peak;
        let mut fell_at: Option<u64> = None;
        for later in &rows[i + 1..] {
            if fell_at.is_none() {
                if later.us.saturating_sub(rows[i].us) > 1_000_000 {
                    break;
                }
                if later.desired.abs() < quarter {
                    fell_at = Some(later.us);
                    let mag = later.actual.abs();
                    if best.as_ref().map(|(_, _, kept)| mag > *kept).unwrap_or(true) {
                        best = Some((later, &rows[i], mag));
                    }
                }
                continue;
            }
            if later.us.saturating_sub(fell_at.unwrap()) > 500_000 || later.desired.abs() >= quarter {
                break;
            }
            let mag = later.actual.abs();
            if best.as_ref().map(|(_, _, kept)| mag > *kept).unwrap_or(true) {
                best = Some((later, &rows[i], mag));
            }
        }
    }
    best.map(|(row, command, _)| (row, command))
}

fn same_dir(desired: f64, actual: f64) -> bool {
    desired != 0.0 && actual != 0.0 && desired.signum() == actual.signum()
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// One decimal at or above 1, three decimals below, so a small error is not shown as zero.
fn round_meas(value: f64) -> f64 {
    if value.abs() >= 1.0 { round1(value) } else { round3(value) }
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn round_d(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn track_point(row: &TrackRow, command: Option<&TrackRow>) -> Value {
    let mut point = json!({
        "t_s": (row.us as f64 / 1_000_000.0 * 100.0).round() / 100.0,
        "desired": round1(row.desired),
        "actual": round1(row.actual),
    });
    for (name, value) in [("p", row.p), ("i", row.i), ("d", row.d), ("ff", row.ff)] {
        if let Some(value) = value {
            point[name] = json!(round_d(value));
        }
    }
    if let Some(command) = command {
        point["command"] = json!(round1(command.desired));
        point["command_t_s"] = json!((command.us as f64 / 1_000_000.0 * 100.0).round() / 100.0);
    }
    point
}

const TRACK_PAIR: &str = "track pairs an actual column with its command on the same row. The command is the actual name with Des before or after it, dem after it, or Tar when the actual column is Act. A D before the name is the desired column. When a two-letter actual name has both a D column and a T column, the command is the T column, the shaped target that loop is tracking, and the D column is the request before shaping. Pass the actual column.";

fn track_labels(labels: &[String], field: &str) -> Result<(String, String), String> {
    let has = |name: &str| labels.iter().any(|label| label == name);
    let pid = has("Tar") && has("Act");
    let Some(actual) = actual_column(labels, field, pid) else {
        return Err(TRACK_PAIR.into());
    };
    let Some(desired) = desired_column(labels, &actual, pid) else {
        return Err(TRACK_PAIR.into());
    };
    if !has(&actual) || !has(&desired) || actual == desired {
        return Err(TRACK_PAIR.into());
    }
    Ok((actual, desired))
}

fn actual_column(labels: &[String], field: &str, pid: bool) -> Option<String> {
    let has = |name: &str| labels.iter().any(|label| label == name);
    if let Some(stem) = field.strip_suffix("Des") {
        if !stem.is_empty() && has(stem) {
            return Some(stem.to_string());
        }
    }
    if let Some(stem) = field.strip_prefix("Des") {
        if !stem.is_empty() && has(stem) {
            return Some(stem.to_string());
        }
    }
    if let Some(stem) = field.strip_suffix("dem") {
        if !stem.is_empty() && has(stem) {
            return Some(stem.to_string());
        }
    }
    if !pid {
        if let Some(stem) = field.strip_prefix("D") {
            if !stem.is_empty() && has(stem) {
                return Some(stem.to_string());
            }
        }
        if let Some(stem) = field.strip_prefix("T") {
            if !stem.is_empty() && has(stem) && has(&format!("D{stem}")) {
                return Some(stem.to_string());
            }
        }
    }
    has(field).then(|| field.to_string())
}

fn desired_column(labels: &[String], actual: &str, pid: bool) -> Option<String> {
    let has = |name: &str| labels.iter().any(|label| label == name);
    let named = [format!("{actual}Des"), format!("Des{actual}"), format!("{actual}dem")];
    if let Some(name) = named.into_iter().find(|name| has(name)) {
        return Some(name);
    }
    if actual == "Act" && has("Tar") {
        return Some("Tar".to_string());
    }
    if pid {
        return None;
    }
    let target = format!("T{actual}");
    let desired = format!("D{actual}");
    if actual.len() == 2 && has(&target) && has(&desired) {
        return Some(target);
    }
    has(&desired).then_some(desired)
}
