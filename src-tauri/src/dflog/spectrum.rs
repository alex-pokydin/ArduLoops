// Gyro spectrum and the FFT.


fn fft_peak(samples: &[(u64, f64)], incomplete: bool) -> Value {
    if samples.len() > 8192 {
        return json!({
            "ok": false,
            "error": "limit_exceeded",
            "limit": 8192,
            "count": samples.len(),
            "note": concat!(
                "This interval has more than 8192 samples. ",
                "The series was not shortened.",
            ),
        });
    }
    let n = next_pow2(samples.len()).max(8);
    if n > 8192 {
        return json!({ "ok": false, "error": "limit_exceeded", "limit": 8192, "count": samples.len() });
    }
    let dts: Vec<f64> = samples.windows(2).map(|w| (w[1].0.saturating_sub(w[0].0)) as f64 / 1_000_000.0).filter(|d| *d > 0.0).collect();
    if dts.is_empty() {
        return json!({ "ok": false, "error": "sample rate is unknown" });
    }
    let mut sorted = dts.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let dt = sorted[sorted.len() / 2];
    let rate = 1.0 / dt;
    let mut re = vec![0.0f64; n];
    let mut im = vec![0.0f64; n];
    let mean = samples.iter().map(|s| s.1).sum::<f64>() / samples.len() as f64;
    for (i, sample) in samples.iter().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (samples.len() as f64)).cos();
        re[i] = (sample.1 - mean) * w;
    }
    fft(&mut re, &mut im, false);
    let mut peak_i = 1usize;
    let mut peak = 0.0f64;
    let bins = n / 2;
    for i in 1..bins {
        let mag = (re[i] * re[i] + im[i] * im[i]).sqrt() / n as f64;
        if mag > peak {
            peak = mag;
            peak_i = i;
        }
    }
    let peak_hz = rate * peak_i as f64 / n as f64;
    let mut out = json!({
        "ok": true,
        "op": "fft",
        "window": "hann",
        "count": samples.len(),
        "fft_n": n,
        "sample_hz": rate,
        "resolution_hz": rate / n as f64,
        "peak_hz": peak_hz,
        "peak_amplitude": peak,
        "coverage": "all finite samples in the interval",
        "tail_incomplete": incomplete,
    });
    if peak_hz < 20.0 {
        out["note"] = json!(concat!(
            "peak_hz is below 20 Hz. ",
            "That is aircraft motion, not a motor harmonic. ",
            "A motor line in this result is a peak at or above 20 Hz.",
        ));
    }
    out
}

fn gyro_spectrum_request(message: &str, field: &str) -> bool {
    let message = message.eq_ignore_ascii_case("IMU")
        || message.eq_ignore_ascii_case("ISBH")
        || message.eq_ignore_ascii_case("ISBD")
        || message.eq_ignore_ascii_case("GYR");
    let field = field.eq_ignore_ascii_case("GyrX")
        || field.eq_ignore_ascii_case("GyrY")
        || field.eq_ignore_ascii_case("GyrZ")
        || field.eq_ignore_ascii_case("x")
        || field.eq_ignore_ascii_case("y")
        || field.eq_ignore_ascii_case("z");
    message && field
}

struct GyroBatch {
    time_us: u64,
    instance: u64,
    mul: f64,
    count: usize,
    rate: f64,
    parts: BTreeMap<u16, [Vec<f64>; 3]>,
}

pub fn gyro_batch_fft(id: &str) -> Value {
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    gyro_batch_fft_bytes(&bytes)
}

fn gyro_batch_fft_bytes(bytes: &[u8]) -> Value {
    let formats = parse_formats(bytes);
    let mut batches: BTreeMap<u16, GyroBatch> = BTreeMap::new();
    let mut throttle = Vec::new();
    let mut rpm = Vec::new();
    let mut notch = Vec::new();
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name == "ISBH" {
            let Some(n) = field_u64(fmt, values, "N") else { return };
            let type_ = field_u64(fmt, values, "type").unwrap_or(255);
            if type_ != 1 || n > u16::MAX as u64 {
                return;
            }
            let instance = field_u64(fmt, values, "instance").unwrap_or(0);
            let mul = field_u64(fmt, values, "mul").unwrap_or(0) as f64;
            let count = field_u64(fmt, values, "smp_cnt").unwrap_or(0) as usize;
            let rate = field_f64(fmt, values, "smp_rate").unwrap_or(0.0);
            if mul <= 0.0 || count < 32 || rate < 40.0 {
                return;
            }
            batches.insert(n as u16, GyroBatch {
                time_us: time_us(fmt, values).unwrap_or(0),
                mul,
                count,
                rate,
                instance,
                parts: BTreeMap::new(),
            });
        } else if fmt.name == "CTUN" {
            if let (Some(t), Some(v)) = (time_us(fmt, values), field_f64(fmt, values, "ThO")) {
                if v.is_finite() {
                    throttle.push((t, v));
                }
            }
        } else if fmt.name == "ESC" {
            if let (Some(t), Some(v)) = (time_us(fmt, values), field_f64(fmt, values, "RPM")) {
                if v.is_finite() && v > 0.0 {
                    rpm.push((t, v));
                }
            }
        } else if fmt.name == "FTNS" {
            if let (Some(t), Some(v)) = (time_us(fmt, values), field_f64(fmt, values, "NF")) {
                if v.is_finite() && v > 0.0 {
                    notch.push((t, v));
                }
            }
        } else if fmt.name == "ISBD" {
            let Some(n) = field_u64(fmt, values, "N") else { return };
            let Some(batch) = batches.get_mut(&(n as u16)) else { return };
            let seq = field_u64(fmt, values, "seqno").unwrap_or(u64::MAX);
            if seq > u16::MAX as u64 {
                return;
            }
            let axes = [
                axis_samples(fmt, values, "x", batch.mul),
                axis_samples(fmt, values, "y", batch.mul),
                axis_samples(fmt, values, "z", batch.mul),
            ];
            batch.parts.insert(seq as u16, axes);
        }
    }, &mut incomplete);
    let mut groups: BTreeMap<u64, GyroGroup> = BTreeMap::new();
    for batch in batches.values() {
        let Some(series) = batch.series() else { continue };
        let fft_n = series[0].len().next_power_of_two().clamp(8, 8192);
        let group = groups.entry(batch.instance).or_insert_with(|| GyroGroup {
            instance: batch.instance,
            rate: batch.rate,
            fft_n,
            used: 0,
            spec: [Vec::new(), Vec::new(), Vec::new()],
            ridge: Vec::new(),
        });
        if (group.rate - batch.rate).abs() > 1.0 || group.fft_n != fft_n {
            continue;
        }
        let mut mags: [Vec<f64>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for axis in 0..3 {
            mags[axis] = magnitude(&series[axis], fft_n);
        }
        let min_bin = ((20.0 * fft_n as f64 / batch.rate).ceil() as usize).clamp(1, mags[0].len().saturating_sub(1));
        let env = |k: usize| mags[0][k].max(mags[1].get(k).copied().unwrap_or(0.0)).max(mags[2].get(k).copied().unwrap_or(0.0));
        let mut ranked = Vec::new();
        for i in min_bin..mags[0].len().saturating_sub(1) {
            let here = env(i);
            if here <= 0.0 || here < env(i - 1) || here < env(i + 1) {
                continue;
            }
            ranked.push((i, here));
        }
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut picked = Vec::new();
        for (i, amp) in ranked {
            if picked.iter().any(|(j, _)| i.abs_diff(*j) <= 3) {
                continue;
            }
            picked.push((i, amp));
            if picked.len() == 3 {
                break;
            }
        }
        if let Some((peak_i, peak)) = picked.first() {
            let hz_of = |i: usize| batch.rate * i as f64 / fft_n as f64;
            group.ridge.push(RidgePoint {
                time_us: batch.time_us,
                hz: hz_of(*peak_i),
                amp: *peak,
                more: [
                    picked.get(1).map(|(i, amp)| (hz_of(*i), *amp)).unwrap_or((0.0, 0.0)),
                    picked.get(2).map(|(i, amp)| (hz_of(*i), *amp)).unwrap_or((0.0, 0.0)),
                ],
            });
        }
        for axis in 0..3 {
            if group.spec[axis].is_empty() {
                group.spec[axis] = std::mem::take(&mut mags[axis]);
            } else {
                for (bin, value) in group.spec[axis].iter_mut().zip(mags[axis].iter()) {
                    *bin += *value;
                }
            }
        }
        group.used += 1;
    }
    let mut views: Vec<Value> = groups.values().filter(|group| group.used > 0).map(gyro_group_view).collect();
    if views.is_empty() {
        return json!({ "ok": false, "error": "no gyro batch in this log" });
    }
    views.sort_by(|a, b| {
        b["fundamental_amplitude"].as_f64().unwrap_or(0.0)
            .partial_cmp(&a["fundamental_amplitude"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let reference_amp = views[0]["fundamental_amplitude"].as_f64().unwrap_or(0.0);
    let reference_bin = views[0]["fundamental_bin"].as_u64().unwrap_or(0) as usize;
    let reference_hz = views[0]["fundamental_hz"].as_f64().unwrap_or(0.0);
    let reference = views[0].clone();
    let harmonic_hz: Vec<(u64, f64)> = reference["harmonics"].as_array().map(|rows| {
        rows.iter().filter_map(|row| Some((row["n"].as_u64()?, row["hz"].as_f64()?))).collect()
    }).unwrap_or_default();
    for view in views.iter_mut().skip(1) {
        let amp = view["envelope"].as_array().and_then(|bins| bins.get(reference_bin)).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let depth = if amp <= 1e-12 { 80.0 } else { 20.0 * (reference_amp / amp).log10() };
        let depth = (depth * 10.0).round() / 10.0;
        view["attenuation_db"] = json!(depth);
        let rows: Vec<Value> = harmonic_hz.iter().filter_map(|(n, hz)| {
            let loud = envelope_at(&reference, *hz)?;
            let quiet = envelope_at(view, *hz)?;
            let db = if quiet <= 1e-12 { 80.0 } else { (20.0 * (loud / quiet).log10() * 10.0).round() / 10.0 };
            Some(json!({ "n": n, "hz": hz, "db": db }))
        }).collect();
        view["harmonic_attenuation_db"] = json!(rows);
        let other_hz = view["fundamental_hz"].as_f64().unwrap_or(0.0);
        if depth >= 10.0 && (other_hz - reference_hz).abs() <= 15.0 {
            view["capture"] = json!("post-filter");
        }
    }
    if views.get(1).and_then(|view| view["capture"].as_str()) == Some("post-filter") {
        views[0]["capture"] = json!("pre-filter");
    }
    let primary = views[0].clone();
    throttle.sort_by_key(|row| row.0);
    rpm.sort_by_key(|row| row.0);
    notch.sort_by_key(|row| row.0);
    let post = views.iter().find(|view| view["capture"].as_str() == Some("post-filter")).map(|view| {
        let mut body = public_capture(view);
        body["spectrogram"] = spectrogram_of(
            groups.get(&view["instance"].as_u64().unwrap_or(0)).map(|group| &group.ridge),
            &throttle,
            &rpm,
            &notch,
        );
        body
    });
    json!({
        "ok": true,
        "op": "fft",
        "source": "gyro batch ISBH/ISBD",
        "type": "gyro",
        "instance": primary["instance"],
        "sample_hz": primary["sample_hz"],
        "resolution_hz": primary["resolution_hz"],
        "batches": primary["batches"],
        "fft_n": primary["fft_n"],
        "band_min_hz": 20,
        "peak_hz": primary["fundamental_hz"],
        "width_3db_hz": primary["width_3db_hz"],
        "harmonics": primary["harmonics"],
        "harmonic_attenuation_db": views.iter().find_map(|view| view.get("harmonic_attenuation_db").filter(|v| v.as_array().is_some_and(|rows| !rows.is_empty()))).cloned().unwrap_or(Value::Null),
        "peaks": primary["peaks"],
        "spectrum": primary["spectrum"],
        "spectrogram": spectrogram_of(groups.get(&primary["instance"].as_u64().unwrap_or(0)).map(|group| &group.ridge), &throttle, &rpm, &notch),
        "axes": primary["axes"],
        "post": post,
        "instances": views.iter().map(public_capture).collect::<Vec<_>>(),
        "note": concat!(
            "peak_hz, harmonics, peaks, spectrum, and the spectrogram describe the raw pre-filter capture. ",
            "post is the filtered capture with the same fields: its peak_hz is the loudest line that remains, not the raw motor line. ",
            "harmonics.db is how far a line sits below that capture's own peak. ",
            "It is not how many dB a filter removed. ",
            "attenuation_db and harmonic_attenuation_db are how much quieter the filtered capture is. ",
            "width_3db_hz is the width of that capture's line. ",
            "A post peak above the raw peak is leftover energy above the raw line. ",
            "Null post means one gyro capture. ",
            "spectrogram.columns is the peak of each batch through the file: t_s, hz, and db against the loudest batch, plus throttle, rpm, or notch_hz when the log has them. ",
            "hz_min, hz_median, and hz_max use the batches within 15 dB of that loudest peak and are not paired with a throttle. ",
            "tracking uses those loud batches that have a throttle: lowest_hz, highest_hz, at_min_throttle, and at_max_throttle are four batches, and throttle_hz_r is their correlation. ",
            "lines are the loud frequencies across batches, not only the single peak. ",
            "follows_throttle true means that line's frequency moved with throttle. ",
            "false means it stayed put. ",
            "null means the batches had no throttle.",
        ),
    })
}

struct RidgePoint {
    time_us: u64,
    hz: f64,
    amp: f64,
    more: [(f64, f64); 2],
}

struct GyroGroup {
    instance: u64,
    rate: f64,
    fft_n: usize,
    used: u32,
    spec: [Vec<f64>; 3],
    ridge: Vec<RidgePoint>,
}

fn public_capture(view: &Value) -> Value {
    json!({
        "instance": view["instance"],
        "capture": view["capture"],
        "batches": view["batches"],
        "sample_hz": view["sample_hz"],
        "resolution_hz": view["resolution_hz"],
        "peak_hz": view["fundamental_hz"],
        "width_3db_hz": view["width_3db_hz"],
        "harmonics": view["harmonics"],
        "peaks": view["peaks"],
        "spectrum": view["spectrum"],
        "axes": view["axes"],
        "attenuation_db": view["attenuation_db"],
        "harmonic_attenuation_db": view["harmonic_attenuation_db"],
    })
}

fn envelope_at(view: &Value, hz: f64) -> Option<f64> {
    let rate = view["sample_hz"].as_f64()?;
    let n = view["fft_n"].as_u64()? as f64;
    if rate <= 0.0 || n <= 0.0 {
        return None;
    }
    let bins = view["envelope"].as_array()?;
    if bins.is_empty() {
        return None;
    }
    let bin = ((hz * n / rate).round() as usize).min(bins.len() - 1);
    bins.get(bin)?.as_f64()
}

fn gyro_group_view(group: &GyroGroup) -> Value {
    let bins = group.fft_n / 2;
    let mut envelope = vec![0.0f64; bins];
    for axis in &group.spec {
        for (bin, mag) in envelope.iter_mut().zip(axis.iter()) {
            *bin = (*bin).max(mag / group.used as f64);
        }
    }
    let min_bin = ((20.0 * group.fft_n as f64 / group.rate).ceil() as usize).clamp(1, bins.saturating_sub(1));
    let mut fund_i = min_bin;
    let mut fund = 0.0;
    for (i, mag) in envelope.iter().enumerate().take(bins).skip(min_bin) {
        if *mag > fund {
            fund = *mag;
            fund_i = i;
        }
    }
    let fund_hz = group.rate * fund_i as f64 / group.fft_n as f64;
    let mut axes = Vec::new();
    for (axis, name) in group.spec.iter().zip(["GyrX", "GyrY", "GyrZ"]) {
        let mut peak_i = min_bin;
        let mut peak = 0.0;
        for (i, mag) in axis.iter().enumerate().take(bins).skip(min_bin) {
            let mag = mag / group.used as f64;
            if mag > peak {
                peak = mag;
                peak_i = i;
            }
        }
        axes.push(json!({
            "field": name,
            "peak_hz": group.rate * peak_i as f64 / group.fft_n as f64,
            "peak_amplitude": peak,
        }));
    }
    let mut harmonics = Vec::new();
    for n in 1..=3 {
        let hz = fund_hz * n as f64;
        if hz >= group.rate * 0.45 {
            break;
        }
        let center = ((hz * group.fft_n as f64 / group.rate).round() as usize).min(bins.saturating_sub(1));
        let from = center.saturating_sub(2).max(1);
        let to = (center + 2).min(bins.saturating_sub(1));
        let bin = (from..=to).max_by(|&a, &b| envelope[a].partial_cmp(&envelope[b]).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(center);
        harmonics.push(json!({
            "n": n,
            "hz": (group.rate * bin as f64 / group.fft_n as f64 * 10.0).round() / 10.0,
            "db": (db_rel(envelope[bin], fund) * 10.0).round() / 10.0,
        }));
    }
    let mut peaks = Vec::new();
    let floor = fund * 10f64.powf(-25.0 / 20.0);
    for i in min_bin..bins.saturating_sub(1) {
        if envelope[i] < floor || envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1] {
            continue;
        }
        let hz = group.rate * i as f64 / group.fft_n as f64;
        let harmonic = (1..=6).find(|n| {
            let target = fund_hz * *n as f64;
            (hz - target).abs() <= (group.rate / group.fft_n as f64) * 1.5
        });
        peaks.push(json!({
            "hz": (hz * 10.0).round() / 10.0,
            "db": (db_rel(envelope[i], fund) * 10.0).round() / 10.0,
            "harmonic": harmonic,
        }));
    }
    peaks.sort_by(|a, b| {
        b["db"].as_f64().unwrap_or(-80.0).partial_cmp(&a["db"].as_f64().unwrap_or(-80.0)).unwrap_or(std::cmp::Ordering::Equal)
    });
    peaks.truncate(8);
    let mut spectrum = Vec::new();
    let end = (bins - 1).max(min_bin + 1);
    let buckets = 32usize;
    let span = (end - min_bin).max(1);
    for bucket in 0..buckets {
        let from = min_bin + span * bucket / buckets;
        let to = min_bin + span * (bucket + 1) / buckets;
        let (center, mag) = envelope[from..to.max(from + 1)].iter().enumerate().max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or((0, &0.0));
        let bin = from + center;
        spectrum.push(json!({
            "hz": (group.rate * bin as f64 / group.fft_n as f64).round(),
            "db": (db_rel(*mag, fund) * 10.0).round() / 10.0,
        }));
    }
    json!({
        "instance": group.instance,
        "sample_hz": group.rate,
        "resolution_hz": group.rate / group.fft_n as f64,
        "batches": group.used,
        "fft_n": group.fft_n,
        "fundamental_hz": fund_hz,
        "fundamental_amplitude": fund,
        "fundamental_bin": fund_i,
        "width_3db_hz": (width_db(&envelope, fund_i, group.rate, group.fft_n, 3.0) * 10.0).round() / 10.0,
        "harmonics": harmonics,
        "peaks": peaks,
        "spectrum": spectrum,
        "axes": axes,
        "envelope": envelope,
        "attenuation_db": Value::Null,
    })
}

fn spectrogram_of(ridge: Option<&Vec<RidgePoint>>, throttle: &[(u64, f64)], rpm: &[(u64, f64)], notch: &[(u64, f64)]) -> Value {
    let mut points: Vec<&RidgePoint> = ridge.map(|rows| rows.iter().collect()).unwrap_or_default();
    points.sort_by_key(|row| row.time_us);
    if points.is_empty() {
        return json!({ "columns": [] });
    }
    let amp_max = points.iter().map(|row| row.amp).fold(0.0, f64::max);
    let loud: Vec<f64> = points.iter().filter(|row| db_rel(row.amp, amp_max) >= -15.0).map(|row| row.hz).collect();
    let span = if loud.is_empty() { points.iter().map(|row| row.hz).collect() } else { loud };
    let mut hz = span;
    let hz_min = hz.iter().copied().fold(f64::INFINITY, f64::min);
    let hz_max = hz.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    hz.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = hz.len() / 2;
    let hz_median = if hz.len() % 2 == 1 { hz[mid] } else { (hz[mid - 1] + hz[mid]) / 2.0 };
    let t0 = points[0].time_us;
    let cap = 48usize;
    let indexes: Vec<usize> = if points.len() <= cap {
        (0..points.len()).collect()
    } else {
        (0..cap).map(|i| i * (points.len() - 1) / (cap - 1)).collect()
    };
    let columns: Vec<Value> = indexes.into_iter().map(|i| {
        let row = points[i];
        let mut column = json!({
            "t_s": ((row.time_us.saturating_sub(t0)) as f64 / 1e6 * 10.0).round() / 10.0,
            "hz": (row.hz * 10.0).round() / 10.0,
            "db": (db_rel(row.amp, amp_max) * 10.0).round() / 10.0,
        });
        if let Some(v) = nearest(throttle, row.time_us, 500_000) {
            column["throttle"] = json!((v * 1000.0).round() / 1000.0);
        }
        if let Some(v) = max_in_window(rpm, row.time_us, 200_000) {
            column["rpm"] = json!(v.round());
        }
        if let Some(v) = nearest(notch, row.time_us, 500_000) {
            column["notch_hz"] = json!((v * 10.0).round() / 10.0);
        }
        column
    }).collect();
    json!({
        "hz_min": (hz_min * 10.0).round() / 10.0,
        "hz_max": (hz_max * 10.0).round() / 10.0,
        "hz_median": (hz_median * 10.0).round() / 10.0,
        "columns": columns,
        "tracking": tracking_of(&columns),
        "lines": spectrum_lines(&points, throttle),
    })
}

fn spectrum_lines(points: &[&RidgePoint], throttle: &[(u64, f64)]) -> Vec<Value> {
    let mut hits = Vec::new();
    for row in points {
        hits.push((row.hz, row.amp, nearest(throttle, row.time_us, 500_000)));
        for (hz, amp) in row.more {
            if hz > 0.0 && amp > 0.0 {
                hits.push((hz, amp, nearest(throttle, row.time_us, 500_000)));
            }
        }
    }
    if hits.is_empty() {
        return Vec::new();
    }
    let amp_max = hits.iter().map(|hit| hit.1).fold(0.0, f64::max);
    let mut kept: Vec<(f64, f64, Option<f64>)> = hits.into_iter().filter(|hit| db_rel(hit.1, amp_max) >= -15.0).collect();
    kept.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut clusters: Vec<Vec<(f64, f64, Option<f64>)>> = Vec::new();
    for hit in kept {
        let join = clusters.last().is_some_and(|cluster| {
            let mid = cluster[cluster.len() / 2].0;
            (hit.0 - mid).abs() <= 12.0_f64.max(0.08 * mid)
        });
        if join {
            clusters.last_mut().unwrap().push(hit);
        } else {
            clusters.push(vec![hit]);
        }
    }
    let mut lines: Vec<(f64, Value)> = clusters.into_iter().filter(|cluster| cluster.len() >= 3).map(|cluster| {
        let amp = cluster.iter().map(|hit| hit.1).fold(0.0, f64::max);
        let mut hz: Vec<f64> = cluster.iter().map(|hit| hit.0).collect();
        hz.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = hz[hz.len() / 2];
        let mut with_thr: Vec<(f64, f64)> = cluster.iter().filter_map(|hit| hit.2.map(|throttle| (throttle, hit.0))).collect();
        let (hz_low, hz_high, follows) = if with_thr.len() >= 3 {
            with_thr.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            let third = (with_thr.len() / 3).max(1);
            let low = median_hz(&with_thr.iter().take(third).map(|hit| hit.1).collect::<Vec<_>>());
            let high = median_hz(&with_thr.iter().rev().take(third).map(|hit| hit.1).collect::<Vec<_>>());
            let span = with_thr.last().unwrap().0 - with_thr.first().unwrap().0;
            let moved = (high - low).abs();
            let follows = span >= 0.08 && moved >= 10.0 && moved >= 0.12 * low.max(1.0);
            (low, high, json!(follows))
        } else {
            (median, median, Value::Null)
        };
        (amp, json!({
            "hz": (median * 10.0).round() / 10.0,
            "hz_low": (hz_low * 10.0).round() / 10.0,
            "hz_high": (hz_high * 10.0).round() / 10.0,
            "hits": cluster.len(),
            "follows_throttle": follows,
        }))
    }).collect();
    lines.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    lines.truncate(4);
    lines.into_iter().map(|(_, line)| line).collect()
}

fn median_hz(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut copy = values.to_vec();
    copy.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    copy[copy.len() / 2]
}

fn tracking_of(columns: &[Value]) -> Value {
    let loud: Vec<&Value> = columns.iter().filter(|column| {
        column["db"].as_f64().unwrap_or(-100.0) >= -15.0 && column.get("throttle").and_then(Value::as_f64).is_some()
    }).collect();
    if loud.len() < 2 {
        return Value::Null;
    }
    let hz_of = |column: &Value| column["hz"].as_f64().unwrap_or(0.0);
    let throttle_of = |column: &Value| column["throttle"].as_f64().unwrap_or(0.0);
    let point = |column: &Value| json!({
        "hz": column["hz"],
        "throttle": column["throttle"],
        "t_s": column["t_s"],
    });
    let mut lowest = loud[0];
    let mut highest = loud[0];
    let mut at_min = loud[0];
    let mut at_max = loud[0];
    for column in &loud {
        if hz_of(column) < hz_of(lowest) { lowest = column; }
        if hz_of(column) > hz_of(highest) { highest = column; }
        if throttle_of(column) < throttle_of(at_min) { at_min = column; }
        if throttle_of(column) > throttle_of(at_max) { at_max = column; }
    }
    let n = loud.len() as f64;
    let mean_x = loud.iter().map(|column| throttle_of(column)).sum::<f64>() / n;
    let mean_y = loud.iter().map(|column| hz_of(column)).sum::<f64>() / n;
    let mut num = 0.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for column in &loud {
        let x = throttle_of(column) - mean_x;
        let y = hz_of(column) - mean_y;
        num += x * y;
        dx += x * x;
        dy += y * y;
    }
    let correlation = if dx > 0.0 && dy > 0.0 { (num / (dx * dy).sqrt() * 100.0).round() / 100.0 } else { 0.0 };
    json!({
        "loud_columns": loud.len(),
        "throttle_hz_r": correlation,
        "lowest_hz": point(lowest),
        "highest_hz": point(highest),
        "at_min_throttle": point(at_min),
        "at_max_throttle": point(at_max),
    })
}

fn nearest(series: &[(u64, f64)], t: u64, window: u64) -> Option<f64> {
    if series.is_empty() {
        return None;
    }
    let i = series.partition_point(|row| row.0 < t).min(series.len() - 1);
    let left = i.saturating_sub(1);
    let (dt, value) = [left, i].into_iter().map(|j| (series[j].0.abs_diff(t), series[j].1)).min_by_key(|row| row.0)?;
    (dt <= window).then_some(value)
}

fn max_in_window(series: &[(u64, f64)], t: u64, window: u64) -> Option<f64> {
    let start = series.partition_point(|row| row.0 < t.saturating_sub(window));
    let end = series.partition_point(|row| row.0 <= t.saturating_add(window));
    series[start..end].iter().map(|row| row.1).filter(|v| v.is_finite() && *v > 0.0).reduce(f64::max)
}

fn db_rel(amp: f64, reference: f64) -> f64 {
    if amp <= 1e-12 || reference <= 1e-12 {
        return -80.0;
    }
    (20.0 * (amp / reference).log10()).clamp(-80.0, 40.0)
}

fn width_db(mag: &[f64], peak_i: usize, rate: f64, n: usize, db: f64) -> f64 {
    let floor = mag.get(peak_i).copied().unwrap_or(0.0) * 10f64.powf(-db / 20.0);
    let mut left = peak_i;
    while left > 0 && mag[left] >= floor {
        left -= 1;
    }
    let mut right = peak_i;
    while right + 1 < mag.len() && mag[right] >= floor {
        right += 1;
    }
    rate * (right.saturating_sub(left)) as f64 / n as f64
}

impl GyroBatch {
    fn series(&self) -> Option<[Vec<f64>; 3]> {
        if self.parts.is_empty() {
            return None;
        }
        let mut out = [Vec::new(), Vec::new(), Vec::new()];
        for (step, seq) in (0..self.parts.len() as u16).enumerate() {
            let Some(part) = self.parts.get(&seq) else { return None };
            if step != seq as usize {
                return None;
            }
            for axis in 0..3 {
                out[axis].extend_from_slice(&part[axis]);
            }
        }
        for axis in &mut out {
            axis.truncate(self.count.min(8192));
            if axis.len() < 32 {
                return None;
            }
        }
        Some(out)
    }
}

fn next_pow2(n: usize) -> usize {
    n.next_power_of_two()
}

fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = 2.0 * std::f64::consts::PI / len as f64 * if inverse { 1.0 } else { -1.0 };
        let wlen_re = ang.cos();
        let wlen_im = ang.sin();
        let mut i = 0;
        while i < n {
            let mut w_re = 1.0;
            let mut w_im = 0.0;
            for k in 0..len / 2 {
                let u_re = re[i + k];
                let u_im = im[i + k];
                let v_re = re[i + k + len / 2] * w_re - im[i + k + len / 2] * w_im;
                let v_im = re[i + k + len / 2] * w_im + im[i + k + len / 2] * w_re;
                re[i + k] = u_re + v_re;
                im[i + k] = u_im + v_im;
                re[i + k + len / 2] = u_re - v_re;
                im[i + k + len / 2] = u_im - v_im;
                let next_re = w_re * wlen_re - w_im * wlen_im;
                w_im = w_re * wlen_im + w_im * wlen_re;
                w_re = next_re;
            }
            i += len;
        }
        len <<= 1;
    }
}
