// MAGFit compass calibration and tuning from DataFlash logs.
// Computes offsets, diagonals, off-diagonals, scale, and motor compensation
// using least-squares fit against the World Magnetic Model (WMM).

const HALF_SQRT_2: f64 = 0.70710678118654752440084436210485;
const HALF_SQRT_2_PLUS_SQRT_2: f64 = 0.92387953251128673848313610506011;
const HALF_SQRT_2_MINUS_SQRT_2: f64 = 0.38268343236508972626808144923416;
const HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO: f64 = 0.65328148243818828788676000840496;
const HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO: f64 = 0.27059805007309845059637609665515;

/// Returns quaternion [w, x, y, z] for standard ArduPilot rotation ID.
pub fn quaternion_from_rotation(rot: u8) -> Option<[f64; 4]> {
    match rot {
        0 => Some([1.0, 0.0, 0.0, 0.0]), // ROTATION_NONE
        1 => Some([HALF_SQRT_2_PLUS_SQRT_2, 0.0, 0.0, HALF_SQRT_2_MINUS_SQRT_2]), // YAW_45
        2 => Some([HALF_SQRT_2, 0.0, 0.0, HALF_SQRT_2]), // YAW_90
        3 => Some([HALF_SQRT_2_MINUS_SQRT_2, 0.0, 0.0, HALF_SQRT_2_PLUS_SQRT_2]), // YAW_135
        4 => Some([0.0, 0.0, 0.0, 1.0]), // YAW_180
        5 => Some([-HALF_SQRT_2_MINUS_SQRT_2, 0.0, 0.0, HALF_SQRT_2_PLUS_SQRT_2]), // YAW_225
        6 => Some([HALF_SQRT_2, 0.0, 0.0, -HALF_SQRT_2]), // YAW_270
        7 => Some([HALF_SQRT_2_PLUS_SQRT_2, 0.0, 0.0, -HALF_SQRT_2_MINUS_SQRT_2]), // YAW_315
        8 => Some([0.0, 1.0, 0.0, 0.0]), // ROLL_180
        9 => Some([0.0, HALF_SQRT_2_PLUS_SQRT_2, HALF_SQRT_2_MINUS_SQRT_2, 0.0]), // ROLL_180_YAW_45
        10 => Some([0.0, HALF_SQRT_2, HALF_SQRT_2, 0.0]), // ROLL_180_YAW_90
        11 => Some([0.0, HALF_SQRT_2_MINUS_SQRT_2, HALF_SQRT_2_PLUS_SQRT_2, 0.0]), // ROLL_180_YAW_135
        12 => Some([0.0, 0.0, 1.0, 0.0]), // PITCH_180
        13 => Some([0.0, -HALF_SQRT_2_MINUS_SQRT_2, HALF_SQRT_2_PLUS_SQRT_2, 0.0]), // ROLL_180_YAW_225
        14 => Some([0.0, -HALF_SQRT_2, HALF_SQRT_2, 0.0]), // ROLL_180_YAW_270
        15 => Some([0.0, HALF_SQRT_2_PLUS_SQRT_2, -HALF_SQRT_2_MINUS_SQRT_2, 0.0]), // ROLL_180_YAW_315
        16 => Some([HALF_SQRT_2, HALF_SQRT_2, 0.0, 0.0]), // ROLL_90
        17 => Some([HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO]), // ROLL_90_YAW_45
        18 => Some([0.5, 0.5, 0.5, 0.5]), // ROLL_90_YAW_90
        19 => Some([HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO]), // ROLL_90_YAW_135
        20 => Some([HALF_SQRT_2, -HALF_SQRT_2, 0.0, 0.0]), // ROLL_270
        21 => Some([HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, -HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO]), // ROLL_270_YAW_45
        22 => Some([0.5, -0.5, -0.5, 0.5]), // ROLL_270_YAW_90
        23 => Some([HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, -HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO]), // ROLL_270_YAW_135
        24 => Some([HALF_SQRT_2, 0.0, HALF_SQRT_2, 0.0]), // PITCH_90
        25 => Some([HALF_SQRT_2, 0.0, -HALF_SQRT_2, 0.0]), // PITCH_270
        26 => Some([0.0, -HALF_SQRT_2, HALF_SQRT_2, 0.0]), // PITCH_180_YAW_90
        27 => Some([0.0, HALF_SQRT_2, HALF_SQRT_2, 0.0]), // PITCH_180_YAW_270
        28 => Some([-0.5, -0.5, -0.5, 0.5]), // ROLL_90_PITCH_90
        29 => Some([0.0, -HALF_SQRT_2, 0.0, HALF_SQRT_2]), // ROLL_180_PITCH_90
        30 => Some([0.5, -0.5, 0.5, 0.5]), // ROLL_270_PITCH_90
        31 => Some([0.0, 0.0, -HALF_SQRT_2, HALF_SQRT_2]), // ROLL_90_PITCH_180
        32 => Some([0.0, 0.0, HALF_SQRT_2, HALF_SQRT_2]), // ROLL_270_PITCH_180
        33 => Some([0.5, 0.5, -0.5, 0.5]), // ROLL_90_PITCH_270
        34 => Some([0.0, HALF_SQRT_2, 0.0, HALF_SQRT_2]), // ROLL_180_PITCH_270
        35 => Some([-0.5, 0.5, 0.5, 0.5]), // ROLL_270_PITCH_270
        36 => Some([-0.5, 0.5, -0.5, 0.5]), // ROLL_90_PITCH_180_YAW_90
        37 => Some([-0.5, -0.5, 0.5, 0.5]), // ROLL_90_YAW_270
        38 => Some([0.2677450050, 0.7069880469, 0.0129576833, -0.6544559667]), // ROLL_90_PITCH_68_YAW_293
        39 => Some([HALF_SQRT_2_PLUS_SQRT_2, 0.0, -HALF_SQRT_2_MINUS_SQRT_2, 0.0]), // PITCH_315
        40 => Some([HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_PLUS_SQRT_TWO, -HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO, HALF_SQRT_HALF_TIMES_TWO_MINUS_SQRT_TWO]), // ROLL_90_PITCH_315
        41 => Some([0.9981347984, 0.0, 0.0610485395, 0.0]), // PITCH_7
        42 => Some([HALF_SQRT_2_PLUS_SQRT_2, HALF_SQRT_2_MINUS_SQRT_2, 0.0, 0.0]), // ROLL_45
        43 => Some([HALF_SQRT_2_PLUS_SQRT_2, -HALF_SQRT_2_MINUS_SQRT_2, 0.0, 0.0]), // ROLL_315
        _ => None,
    }
}

pub fn rotation_name(rot: u8) -> &'static str {
    match rot {
        0 => "ROTATION_NONE (0)",
        1 => "ROTATION_YAW_45 (1)",
        2 => "ROTATION_YAW_90 (2)",
        3 => "ROTATION_YAW_135 (3)",
        4 => "ROTATION_YAW_180 (4)",
        5 => "ROTATION_YAW_225 (5)",
        6 => "ROTATION_YAW_270 (6)",
        7 => "ROTATION_YAW_315 (7)",
        8 => "ROTATION_ROLL_180 (8)",
        9 => "ROTATION_ROLL_180_YAW_45 (9)",
        10 => "ROTATION_ROLL_180_YAW_90 (10)",
        11 => "ROTATION_ROLL_180_YAW_135 (11)",
        12 => "ROTATION_PITCH_180 (12)",
        13 => "ROTATION_ROLL_180_YAW_225 (13)",
        14 => "ROTATION_ROLL_180_YAW_270 (14)",
        15 => "ROTATION_ROLL_180_YAW_315 (15)",
        16 => "ROTATION_ROLL_90 (16)",
        17 => "ROTATION_ROLL_90_YAW_45 (17)",
        18 => "ROTATION_ROLL_90_YAW_90 (18)",
        19 => "ROTATION_ROLL_90_YAW_135 (19)",
        20 => "ROTATION_ROLL_270 (20)",
        21 => "ROTATION_ROLL_270_YAW_45 (21)",
        22 => "ROTATION_ROLL_270_YAW_90 (22)",
        23 => "ROTATION_ROLL_270_YAW_135 (23)",
        24 => "ROTATION_PITCH_90 (24)",
        25 => "ROTATION_PITCH_270 (25)",
        26 => "ROTATION_PITCH_180_YAW_90 (26)",
        27 => "ROTATION_PITCH_180_YAW_270 (27)",
        28 => "ROTATION_ROLL_90_PITCH_90 (28)",
        29 => "ROTATION_ROLL_180_PITCH_90 (29)",
        30 => "ROTATION_ROLL_270_PITCH_90 (30)",
        31 => "ROTATION_ROLL_90_PITCH_180 (31)",
        32 => "ROTATION_ROLL_270_PITCH_180 (32)",
        33 => "ROTATION_ROLL_90_PITCH_270 (33)",
        34 => "ROTATION_ROLL_180_PITCH_270 (34)",
        35 => "ROTATION_ROLL_270_PITCH_270 (35)",
        36 => "ROTATION_ROLL_90_PITCH_180_YAW_90 (36)",
        37 => "ROTATION_ROLL_90_YAW_270 (37)",
        38 => "ROTATION_ROLL_90_PITCH_68_YAW_293 (38)",
        39 => "ROTATION_PITCH_315 (39)",
        40 => "ROTATION_ROLL_90_PITCH_315 (40)",
        41 => "ROTATION_PITCH_7 (41)",
        42 => "ROTATION_ROLL_45 (42)",
        43 => "ROTATION_ROLL_315 (43)",
        _ => "CUSTOM",
    }
}

pub fn quaternion_from_euler(roll_rad: f64, pitch_rad: f64, yaw_rad: f64) -> [f64; 4] {
    let cr = (roll_rad * 0.5).cos();
    let sr = (roll_rad * 0.5).sin();
    let cp = (pitch_rad * 0.5).cos();
    let sp = (pitch_rad * 0.5).sin();
    let cy = (yaw_rad * 0.5).cos();
    let sy = (yaw_rad * 0.5).sin();

    [
        cr * cp * cy + sr * sp * sy,
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
    ]
}

/// Rotates 3D vector v by unit quaternion q [w, x, y, z].
pub fn quaternion_rotate(q: [f64; 4], v: [f64; 3]) -> [f64; 3] {
    let u = [q[1], q[2], q[3]];
    let s = q[0];

    // t = 2 * (u x v)
    let tx = 2.0 * (u[1] * v[2] - u[2] * v[1]);
    let ty = 2.0 * (u[2] * v[0] - u[0] * v[2]);
    let tz = 2.0 * (u[0] * v[1] - u[1] * v[0]);

    // v' = v + s * t + (u x t)
    [
        v[0] + s * tx + (u[1] * tz - u[2] * ty),
        v[1] + s * ty + (u[2] * tx - u[0] * tz),
        v[2] + s * tz + (u[0] * ty - u[1] * tx),
    ]
}

/// Spherical linear interpolation between two unit quaternions.
pub fn quaternion_slerp(q1: [f64; 4], mut q2: [f64; 4], t: f64) -> [f64; 4] {
    let mut dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
    if dot < 0.0 {
        q2 = [-q2[0], -q2[1], -q2[2], -q2[3]];
        dot = -dot;
    }
    if dot > 0.9995 {
        let w = (1.0 - t) * q1[0] + t * q2[0];
        let x = (1.0 - t) * q1[1] + t * q2[1];
        let y = (1.0 - t) * q1[2] + t * q2[2];
        let z = (1.0 - t) * q1[3] + t * q2[3];
        let len = (w * w + x * x + y * y + z * z).sqrt();
        if len > 0.0 {
            return [w / len, x / len, y / len, z / len];
        }
        return q1;
    }
    let theta = dot.clamp(-1.0, 1.0).acos();
    let sin_theta = theta.sin();
    if sin_theta.abs() < 1e-6 {
        return q1;
    }
    let w1 = ((1.0 - t) * theta).sin() / sin_theta;
    let w2 = (t * theta).sin() / sin_theta;
    [
        w1 * q1[0] + w2 * q2[0],
        w1 * q1[1] + w2 * q2[1],
        w1 * q1[2] + w2 * q2[2],
        w1 * q1[3] + w2 * q2[3],
    ]
}

/// Solves linear system A * x = b for N <= 12 using Gaussian elimination with partial pivoting.
fn solve_linear_system<const N: usize>(mut a: [[f64; N]; N], mut b: [f64; N]) -> Option<[f64; N]> {
    for i in 0..N {
        let mut max_row = i;
        let mut max_val = a[i][i].abs();
        for r in (i + 1)..N {
            let val = a[r][i].abs();
            if val > max_val {
                max_val = val;
                max_row = r;
            }
        }
        if max_val < 1e-12 {
            return None;
        }
        if max_row != i {
            a.swap(i, max_row);
            b.swap(i, max_row);
        }
        let pivot = a[i][i];
        for c in i..N {
            a[i][c] /= pivot;
        }
        b[i] /= pivot;

        for r in 0..N {
            if r != i {
                let factor = a[r][i];
                if factor.abs() > 1e-15 {
                    for c in i..N {
                        a[r][c] -= factor * a[i][c];
                    }
                    b[r] -= factor * b[i];
                }
            }
        }
    }
    Some(b)
}

/// Inverts symmetric 3x3 matrix:
/// [d0, o0, o1]
/// [o0, d1, o2]
/// [o1, o2, d2]
fn invert_symmetric_3x3(d: [f64; 3], o: [f64; 3]) -> Option<[[f64; 3]; 3]> {
    let d0 = d[0]; let d1 = d[1]; let d2 = d[2];
    let o0 = o[0]; let o1 = o[1]; let o2 = o[2];
    let c00 = d1 * d2 - o2 * o2;
    let c01 = o2 * o1 - o0 * d2;
    let c02 = o0 * o2 - o1 * d1;
    let det = d0 * c00 + o0 * c01 + o1 * c02;
    if det.abs() < 1e-12 {
        return None;
    }
    let inv_det = 1.0 / det;
    let c11 = d0 * d2 - o1 * o1;
    let c12 = o1 * o0 - d0 * o2;
    let c22 = d0 * d1 - o0 * o0;
    Some([
        [c00 * inv_det, c01 * inv_det, c02 * inv_det],
        [c01 * inv_det, c11 * inv_det, c12 * inv_det],
        [c02 * inv_det, c12 * inv_det, c22 * inv_det],
    ])
}

/// Computes spherical bin lattice (Fibonacci lattice, 80 bins).
fn compute_fibonacci_bins() -> [[f64; 3]; 80] {
    let mut bins = [[0.0f64; 3]; 80];
    for i in 0..80 {
        let k = i as f64 + 0.5;
        let phi = (1.0 - 2.0 * k / 80.0).acos();
        let theta = std::f64::consts::PI * (1.0 + 5.0f64.sqrt()) * k;
        bins[i] = [
            theta.cos() * phi.sin(),
            theta.sin() * phi.sin(),
            phi.cos(),
        ];
    }
    bins
}

fn closest_bin(v: [f64; 3], bins: &[[f64; 3]; 80]) -> usize {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-6 {
        return 0;
    }
    let u = [v[0] / len, v[1] / len, v[2] / len];
    let mut min_idx = 0;
    let mut min_dist_sq = f64::MAX;
    for (i, bin) in bins.iter().enumerate() {
        let dx = u[0] - bin[0];
        let dy = u[1] - bin[1];
        let dz = u[2] - bin[2];
        let d = dx * dx + dy * dy + dz * dz;
        if d < min_dist_sq {
            min_dist_sq = d;
            min_idx = i;
        }
    }
    min_idx
}

#[allow(dead_code)]
struct CompassParams {
    ofs: [f64; 3],
    dia: [f64; 3],
    odi: [f64; 3],
    scale: f64,
    mot: [f64; 3],
    orientation: u8,
    external: bool,
    dev_id: u32,
}

#[derive(Clone, Copy)]
struct MagPoint {
    us: u64,
    raw: [f64; 3],
    orig_cal: [f64; 3],
    expected: [f64; 3],
    motor_val: f64,
}

/// Main entry point for MAGFit calculation from log file bytes.
pub fn magfit_bytes(
    bytes: &[u8],
    compass_idx: usize,
    fit_type: &str,
    motor_comp: &str,
    check_orient: bool,
    start_us: Option<u64>,
    end_us: Option<u64>,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Value {
    if compass_idx < 1 || compass_idx > 3 {
        return json!({ "ok": false, "error": "compass must be 1, 2, or 3" });
    }
    let formats = parse_formats(bytes);
    if formats.is_empty() {
        return json!({ "ok": false, "error": "No message format headers found in log" });
    }

    // 1. Extract GPS / Origin position for WMM
    let mut origin_lat = None;
    let mut origin_lon = None;
    let mut parm_lat = None;
    let mut parm_lon = None;
    let mut parms: BTreeMap<String, f64> = BTreeMap::new();

    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name == "PARM" {
            if let (Some(name), Some(val)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                parms.insert(name.clone(), val);
                if name == "AHRS_ORIGIN_LAT" && val.abs() > 0.001 {
                    parm_lat = Some(val);
                } else if name == "AHRS_ORIGIN_LON" && val.abs() > 0.001 {
                    parm_lon = Some(val);
                }
            }
        } else if origin_lat.is_none() {
            if fmt.name == "ORGN" {
                if let (Some(lat), Some(lng)) = (field_f64(fmt, values, "Lat"), field_f64(fmt, values, "Lng")) {
                    let lat_deg = if lat.abs() > 90.0 { lat * 1e-7 } else { lat };
                    let lng_deg = if lng.abs() > 180.0 { lng * 1e-7 } else { lng };
                    if lat_deg.abs() > 0.001 || lng_deg.abs() > 0.001 {
                        origin_lat = Some(lat_deg);
                        origin_lon = Some(lng_deg);
                    }
                }
            } else if fmt.name == "POS" || fmt.name == "GPS" {
                if let (Some(lat), Some(lng)) = (field_f64(fmt, values, "Lat"), field_f64(fmt, values, "Lng")) {
                    let lat_deg = if lat.abs() > 90.0 { lat * 1e-7 } else { lat };
                    let lng_deg = if lng.abs() > 180.0 { lng * 1e-7 } else { lng };
                    if (lat_deg.abs() > 0.001 || lng_deg.abs() > 0.001) && lat_deg.abs() <= 90.0 && lng_deg.abs() <= 180.0 {
                        origin_lat = Some(lat_deg);
                        origin_lon = Some(lng_deg);
                    }
                }
            }
        }
    }, &mut incomplete);

    let (lat_deg, lon_deg, coord_source) = match (lat.or(origin_lat).or(parm_lat), lon.or(origin_lon).or(parm_lon)) {
        (Some(l), Some(r)) => {
            let source = if lat.is_some() && lon.is_some() {
                "manual"
            } else if origin_lat.is_some() {
                "log_origin"
            } else {
                "parameter"
            };
            (l, r, source)
        }
        _ => return json!({
            "ok": false,
            "error": "No GPS or origin coordinates found in log to calculate Earth magnetic field. Provide manual 'lat' and 'lon' coordinates (in degrees) for the flight location."
        }),
    };

    let earth_field_ned = match expected_earth_field(lat_deg, lon_deg) {
        Some(ef) => ef,
        None => return json!({
            "ok": false,
            "error": format!("Location ({:.4}, {:.4}) outside World Magnetic Model sampling range.", lat_deg, lon_deg)
        }),
    };

    // 2. Compass active parameters from log
    let stem_num = if compass_idx == 1 { "".to_string() } else { compass_idx.to_string() };

    let p_ofs_x = parms.get(&format!("COMPASS_OFS{}_X", stem_num)).copied().unwrap_or(0.0);
    let p_ofs_y = parms.get(&format!("COMPASS_OFS{}_Y", stem_num)).copied().unwrap_or(0.0);
    let p_ofs_z = parms.get(&format!("COMPASS_OFS{}_Z", stem_num)).copied().unwrap_or(0.0);

    let p_dia_x = parms.get(&format!("COMPASS_DIA{}_X", stem_num)).copied().unwrap_or(1.0);
    let p_dia_y = parms.get(&format!("COMPASS_DIA{}_Y", stem_num)).copied().unwrap_or(1.0);
    let p_dia_z = parms.get(&format!("COMPASS_DIA{}_Z", stem_num)).copied().unwrap_or(1.0);

    let p_odi_x = parms.get(&format!("COMPASS_ODI{}_X", stem_num)).copied().unwrap_or(0.0);
    let p_odi_y = parms.get(&format!("COMPASS_ODI{}_Y", stem_num)).copied().unwrap_or(0.0);
    let p_odi_z = parms.get(&format!("COMPASS_ODI{}_Z", stem_num)).copied().unwrap_or(0.0);

    let p_scale = parms.get(&format!("COMPASS_SCALE{}", stem_num)).copied().unwrap_or(0.0);
    let p_orient = parms.get(&format!("COMPASS_ORIENT{}", stem_num)).copied().unwrap_or(0.0) as u8;
    let p_external = parms.get(&format!("COMPASS_EXTERN{}", stem_num))
        .or_else(|| parms.get(&format!("COMPASS_EXTERNAL{}", stem_num)))
        .copied().unwrap_or(0.0) > 0.0;
    let p_dev_id = parms.get(&format!("COMPASS_DEV_ID{}", stem_num)).copied().unwrap_or(0.0) as u32;

    let p_mot_x = parms.get(&format!("COMPASS_MOT{}_X", stem_num)).copied().unwrap_or(0.0);
    let p_mot_y = parms.get(&format!("COMPASS_MOT{}_Y", stem_num)).copied().unwrap_or(0.0);
    let p_mot_z = parms.get(&format!("COMPASS_MOT{}_Z", stem_num)).copied().unwrap_or(0.0);

    let logged_params = CompassParams {
        ofs: [p_ofs_x, p_ofs_y, p_ofs_z],
        dia: [p_dia_x, p_dia_y, p_dia_z],
        odi: [p_odi_x, p_odi_y, p_odi_z],
        scale: if p_scale > 0.2 && p_scale < 2.0 { p_scale } else { 1.0 },
        mot: [p_mot_x, p_mot_y, p_mot_z],
        orientation: p_orient,
        external: p_external,
        dev_id: p_dev_id,
    };

    // 3. Collect attitude samples
    struct AttSample {
        us: u64,
        q: [f64; 4],
    }
    let mut att_samples: Vec<AttSample> = Vec::new();
    let has_ahr2 = formats.values().any(|fmt| fmt.name == "AHR2");

    walk(bytes, &formats, |fmt, _, values| {
        let is_att = if has_ahr2 { fmt.name == "AHR2" } else { fmt.name == "ATT" || fmt.name == "XKF1" };
        if !is_att {
            return;
        }
        let Some(us) = time_us(fmt, values) else { return };
        if let (Some(q1), Some(q2), Some(q3), Some(q4)) = (
            field_f64(fmt, values, "Q1"),
            field_f64(fmt, values, "Q2"),
            field_f64(fmt, values, "Q3"),
            field_f64(fmt, values, "Q4"),
        ) {
            let len = (q1 * q1 + q2 * q2 + q3 * q3 + q4 * q4).sqrt();
            if len > 0.5 && len < 1.5 {
                att_samples.push(AttSample { us, q: [q1 / len, q2 / len, q3 / len, q4 / len] });
                return;
            }
        }
        if let (Some(roll), Some(pitch), Some(yaw)) = (
            field_f64(fmt, values, "Roll"),
            field_f64(fmt, values, "Pitch"),
            field_f64(fmt, values, "Yaw"),
        ) {
            let q = quaternion_from_euler(roll.to_radians(), pitch.to_radians(), yaw.to_radians());
            att_samples.push(AttSample { us, q });
        }
    }, &mut incomplete);

    if att_samples.is_empty() {
        return json!({ "ok": false, "error": "No attitude (AHR2/ATT/XKF1) records found in log." });
    }
    att_samples.sort_by_key(|a| a.us);

    // 4. Collect motor samples and peak battery current
    struct MotSample {
        us: u64,
        val: f64,
    }
    let mut mot_samples: Vec<MotSample> = Vec::new();
    let mut max_curr = 0.0f64;
    let mut max_curr_us = 0u64;
    let use_mot = motor_comp.eq_ignore_ascii_case("current") || motor_comp.eq_ignore_ascii_case("throttle");
    let is_curr = motor_comp.eq_ignore_ascii_case("current");

    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name == "BAT" {
            if let (Some(us), Some(curr)) = (time_us(fmt, values), field_f64(fmt, values, "Curr")) {
                if curr > max_curr {
                    max_curr = curr;
                    max_curr_us = us;
                }
                if use_mot && is_curr {
                    mot_samples.push(MotSample { us, val: curr });
                }
            }
        } else if use_mot && !is_curr && (fmt.name == "RATE" || fmt.name == "CTUN") {
            let col = if fmt.name == "RATE" { "AOut" } else { "ThO" };
            if let (Some(us), Some(tho)) = (time_us(fmt, values), field_f64(fmt, values, col)) {
                mot_samples.push(MotSample { us, val: tho });
            }
        }
    }, &mut incomplete);
    if use_mot {
        mot_samples.sort_by_key(|m| m.us);
    }

    // 5. Collect MAG samples
    let target_instance = compass_idx - 1;
    let target_msg_name = if formats.values().any(|fmt| fmt.name == "MAG" && fmt.labels.iter().any(|l| l == "I")) {
        "MAG".to_string()
    } else if compass_idx == 1 {
        "MAG".to_string()
    } else {
        format!("MAG{}", compass_idx)
    };

    let mut points: Vec<MagPoint> = Vec::new();
    let mut first_mag_us = 0u64;
    let mut last_mag_us = 0u64;
    let bins = compute_fibonacci_bins();

    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name != target_msg_name {
            return;
        }
        if let Some(inst) = field_u64(fmt, values, "I") {
            if inst as usize != target_instance {
                return;
            }
        }
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }
        if first_mag_us == 0 {
            first_mag_us = us;
        }
        last_mag_us = us;

        let Some(mx) = field_f64(fmt, values, "MagX") else { return };
        let Some(my) = field_f64(fmt, values, "MagY") else { return };
        let Some(mz) = field_f64(fmt, values, "MagZ") else { return };
        let ofs_x = field_f64(fmt, values, "OfsX").unwrap_or(p_ofs_x);
        let ofs_y = field_f64(fmt, values, "OfsY").unwrap_or(p_ofs_y);
        let ofs_z = field_f64(fmt, values, "OfsZ").unwrap_or(p_ofs_z);

        // Interpolate attitude quaternion
        let att_idx = match att_samples.binary_search_by_key(&us, |a| a.us) {
            Ok(idx) => idx,
            Err(0) => 0,
            Err(idx) if idx >= att_samples.len() => att_samples.len() - 1,
            Err(idx) => {
                let a0 = &att_samples[idx - 1];
                let a1 = &att_samples[idx];
                let dt = (a1.us - a0.us) as f64;
                if dt > 500_000.0 {
                    return; // Too large gap
                }
                let t = (us - a0.us) as f64 / dt;
                let q_interp = quaternion_slerp(a0.q, a1.q, t);
                // Rotate earth field into body frame
                let q_inv = [q_interp[0], -q_interp[1], -q_interp[2], -q_interp[3]];
                let expected = quaternion_rotate(q_inv, earth_field_ned);

                // Recover raw sensor values:
                let mut rx = mx - ofs_x;
                let mut ry = my - ofs_y;
                let mut rz = mz - ofs_z;
                if logged_params.scale > 0.2 && logged_params.scale < 2.0 {
                    rx /= logged_params.scale;
                    ry /= logged_params.scale;
                    rz /= logged_params.scale;
                }
                if logged_params.external && logged_params.orientation != 0 {
                    if let Some(q_orient) = quaternion_from_rotation(logged_params.orientation) {
                        let q_orient_inv = [q_orient[0], -q_orient[1], -q_orient[2], -q_orient[3]];
                        let sensor_r = quaternion_rotate(q_orient_inv, [rx, ry, rz]);
                        rx = sensor_r[0];
                        ry = sensor_r[1];
                        rz = sensor_r[2];
                    }
                }

                // Interpolate motor value
                let mut m_val = 0.0;
                if use_mot && !mot_samples.is_empty() {
                    match mot_samples.binary_search_by_key(&us, |m| m.us) {
                        Ok(mi) => m_val = mot_samples[mi].val,
                        Err(0) => m_val = mot_samples[0].val,
                        Err(mi) if mi >= mot_samples.len() => m_val = mot_samples[mot_samples.len() - 1].val,
                        Err(mi) => {
                            let m0 = &mot_samples[mi - 1];
                            let m1 = &mot_samples[mi];
                            let m_dt = (m1.us - m0.us) as f64;
                            if m_dt < 500_000.0 && m_dt > 0.0 {
                                let mt = (us - m0.us) as f64 / m_dt;
                                m_val = m0.val + mt * (m1.val - m0.val);
                            } else {
                                m_val = m0.val;
                            }
                        }
                    }
                }

                points.push(MagPoint {
                    us,
                    raw: [rx, ry, rz],
                    orig_cal: [mx, my, mz],
                    expected,
                    motor_val: m_val,
                });
                return;
            }
        };

        let q_att = att_samples[att_idx].q;
        let q_inv = [q_att[0], -q_att[1], -q_att[2], -q_att[3]];
        let expected = quaternion_rotate(q_inv, earth_field_ned);

        let mut rx = mx - ofs_x;
        let mut ry = my - ofs_y;
        let mut rz = mz - ofs_z;
        if logged_params.scale > 0.2 && logged_params.scale < 2.0 {
            rx /= logged_params.scale;
            ry /= logged_params.scale;
            rz /= logged_params.scale;
        }
        if logged_params.external && logged_params.orientation != 0 {
            if let Some(q_orient) = quaternion_from_rotation(logged_params.orientation) {
                let q_orient_inv = [q_orient[0], -q_orient[1], -q_orient[2], -q_orient[3]];
                let sensor_r = quaternion_rotate(q_orient_inv, [rx, ry, rz]);
                rx = sensor_r[0];
                ry = sensor_r[1];
                rz = sensor_r[2];
            }
        }

        points.push(MagPoint {
            us,
            raw: [rx, ry, rz],
            orig_cal: [mx, my, mz],
            expected,
            motor_val: 0.0,
        });
    }, &mut incomplete);

    if points.len() < 30 {
        return json!({
            "ok": false,
            "error": format!("Insufficient compass samples ({}) in selected time range. Fly and maneuver vehicle before running fit.", points.len())
        });
    }

    // 6. Spherical binning and weights
    let n = points.len();
    let mut bin_counts = [0usize; 80];
    let mut point_bins = Vec::with_capacity(n);
    for pt in &points {
        let b = closest_bin(pt.expected, &bins);
        point_bins.push(b);
        bin_counts[b] += 1;
    }
    let unique_bins = bin_counts.iter().filter(|&&c| c > 0).count();
    let mean_bin_size = n as f64 / unique_bins as f64;
    let coverage_pct = (unique_bins as f64 / 80.0 * 100.0).round();
    let mut weights = Vec::with_capacity(n);
    for &b in &point_bins {
        weights.push(mean_bin_size / bin_counts[b] as f64);
    }

    // 7. Orientation Verification
    let mut orient_result = json!({
        "logged": rotation_name(logged_params.orientation),
        "matches": true,
        "cost_ratio": 1.0,
    });
    let mut effective_orientation = logged_params.orientation;

    if check_orient {
        let mut ef_mean = [0.0; 3];
        for pt in &points {
            ef_mean[0] += pt.expected[0];
            ef_mean[1] += pt.expected[1];
            ef_mean[2] += pt.expected[2];
        }
        ef_mean[0] /= n as f64;
        ef_mean[1] /= n as f64;
        ef_mean[2] /= n as f64;

        let mut rot_scores: Vec<(u8, f64)> = Vec::new();
        for rot in 0..=43 {
            if rot == 38 || rot == 41 {
                continue;
            }
            let Some(q_rot) = quaternion_from_rotation(rot) else { continue };

            let mut rotated_points = Vec::with_capacity(n);
            let mut mean_sensor = [0.0; 3];
            for pt in &points {
                let r = quaternion_rotate(q_rot, pt.raw);
                rotated_points.push(r);
                mean_sensor[0] += r[0];
                mean_sensor[1] += r[1];
                mean_sensor[2] += r[2];
            }
            mean_sensor[0] /= n as f64;
            mean_sensor[1] /= n as f64;
            mean_sensor[2] /= n as f64;

            let ofs = [
                ef_mean[0] - mean_sensor[0],
                ef_mean[1] - mean_sensor[1],
                ef_mean[2] - mean_sensor[2],
            ];

            let mut err_sum = 0.0;
            for j in 0..n {
                let r = rotated_points[j];
                let ex = points[j].expected;
                let dx = r[0] - ex[0] + ofs[0];
                let dy = r[1] - ex[1] + ofs[1];
                let dz = r[2] - ex[2] + ofs[2];
                err_sum += weights[j] * (dx * dx + dy * dy + dz * dz);
            }
            rot_scores.push((rot, err_sum / n as f64));
        }

        rot_scores.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        if rot_scores.len() >= 2 {
            let best = rot_scores[0];
            let second = rot_scores[1];
            let ratio = if best.1 > 1e-6 { second.1 / best.1 } else { 1.0 };
            let matches = best.0 == logged_params.orientation;
            effective_orientation = best.0;

            orient_result = json!({
                "logged": rotation_name(logged_params.orientation),
                "best_fit": rotation_name(best.0),
                "second_best": rotation_name(second.0),
                "cost_ratio": (ratio * 100.0).round() / 100.0,
                "matches": matches,
            });
        }
    }

    // Rotate raw readings by the effective orientation for body-frame fitting:
    let q_body = quaternion_from_rotation(effective_orientation).unwrap_or([1.0, 0.0, 0.0, 0.0]);
    let mut body_raw: Vec<[f64; 3]> = Vec::with_capacity(n);
    for pt in &points {
        body_raw.push(quaternion_rotate(q_body, pt.raw));
    }

    // 8. Calculate Original Error RMS (with logged calibration)
    let mut orig_err_sq = 0.0;
    for j in 0..n {
        let cal = points[j].orig_cal;
        let exp = points[j].expected;
        let d = (cal[0] - exp[0]).powi(2) + (cal[1] - exp[1]).powi(2) + (cal[2] - exp[2]).powi(2);
        orig_err_sq += weights[j] * d;
    }
    let orig_error_mgauss = ((orig_err_sq / n as f64).sqrt() * 10.0).round() / 10.0;

    // 9. Least Squares Fitting
    let fit_mot = use_mot && !mot_samples.is_empty();
    let fit_mode = fit_type.to_ascii_lowercase();

    let mut out_ofs = [0.0; 3];
    let mut out_dia = [1.0; 3];
    let mut out_odi = [0.0; 3];
    let mut out_scale = 1.0;
    let mut out_mot = [0.0; 3];

    let mut fit_succeeded = false;

    if fit_mode == "iron" {
        // K = 9 or 12
        if fit_mot {
            let mut a_mat = [[0.0f64; 12]; 12];
            let mut b_vec = [0.0f64; 12];
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;
                let t = points[j].motor_val;

                // 3 rows for sample j:
                let rows: [[f64; 12]; 3] = [
                    [1.0, 0.0, 0.0, r[0], 0.0,  0.0,  r[1], r[2], 0.0,  t,   0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0,  r[1], 0.0,  r[0], 0.0,  r[2], 0.0, t,   0.0],
                    [0.0, 0.0, 1.0, 0.0,  0.0,  r[2], 0.0,  r[0], r[1], 0.0, 0.0, t  ],
                ];
                for row_idx in 0..3 {
                    let a_row = rows[row_idx];
                    let b_val = e[row_idx];
                    for r_i in 0..12 {
                        b_vec[r_i] += w * a_row[r_i] * b_val;
                        for c_i in 0..12 {
                            a_mat[r_i][c_i] += w * a_row[r_i] * a_row[c_i];
                        }
                    }
                }
            }
            if let Some(sol) = solve_linear_system(a_mat, b_vec) {
                let uncorr_ofs = [sol[0], sol[1], sol[2]];
                let dia = [sol[3], sol[4], sol[5]];
                let odi = [sol[6], sol[7], sol[8]];
                let mot = [sol[9], sol[10], sol[11]];
                if let Some(inv_iron) = invert_symmetric_3x3(dia, odi) {
                    out_ofs[0] = uncorr_ofs[0] * inv_iron[0][0] + uncorr_ofs[1] * inv_iron[1][0] + uncorr_ofs[2] * inv_iron[2][0];
                    out_ofs[1] = uncorr_ofs[0] * inv_iron[0][1] + uncorr_ofs[1] * inv_iron[1][1] + uncorr_ofs[2] * inv_iron[2][1];
                    out_ofs[2] = uncorr_ofs[0] * inv_iron[0][2] + uncorr_ofs[1] * inv_iron[1][2] + uncorr_ofs[2] * inv_iron[2][2];

                    let mean_scale = (dia[0] + dia[1] + dia[2]) / 3.0;
                    if mean_scale > 0.1 {
                        out_scale = mean_scale;
                        out_dia = [dia[0] / mean_scale, dia[1] / mean_scale, dia[2] / mean_scale];
                        out_odi = [odi[0] / mean_scale, odi[1] / mean_scale, odi[2] / mean_scale];
                        out_mot = mot;
                        fit_succeeded = true;
                    }
                }
            }
        } else {
            let mut a_mat = [[0.0f64; 9]; 9];
            let mut b_vec = [0.0f64; 9];
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;

                let rows: [[f64; 9]; 3] = [
                    [1.0, 0.0, 0.0, r[0], 0.0,  0.0,  r[1], r[2], 0.0],
                    [0.0, 1.0, 0.0, 0.0,  r[1], 0.0,  r[0], 0.0,  r[2]],
                    [0.0, 0.0, 1.0, 0.0,  0.0,  r[2], 0.0,  r[0], r[1]],
                ];
                for row_idx in 0..3 {
                    let a_row = rows[row_idx];
                    let b_val = e[row_idx];
                    for r_i in 0..9 {
                        b_vec[r_i] += w * a_row[r_i] * b_val;
                        for c_i in 0..9 {
                            a_mat[r_i][c_i] += w * a_row[r_i] * a_row[c_i];
                        }
                    }
                }
            }
            if let Some(sol) = solve_linear_system(a_mat, b_vec) {
                let uncorr_ofs = [sol[0], sol[1], sol[2]];
                let dia = [sol[3], sol[4], sol[5]];
                let odi = [sol[6], sol[7], sol[8]];
                if let Some(inv_iron) = invert_symmetric_3x3(dia, odi) {
                    out_ofs[0] = uncorr_ofs[0] * inv_iron[0][0] + uncorr_ofs[1] * inv_iron[1][0] + uncorr_ofs[2] * inv_iron[2][0];
                    out_ofs[1] = uncorr_ofs[0] * inv_iron[0][1] + uncorr_ofs[1] * inv_iron[1][1] + uncorr_ofs[2] * inv_iron[2][1];
                    out_ofs[2] = uncorr_ofs[0] * inv_iron[0][2] + uncorr_ofs[1] * inv_iron[1][2] + uncorr_ofs[2] * inv_iron[2][2];

                    let mean_scale = (dia[0] + dia[1] + dia[2]) / 3.0;
                    if mean_scale > 0.1 {
                        out_scale = mean_scale;
                        out_dia = [dia[0] / mean_scale, dia[1] / mean_scale, dia[2] / mean_scale];
                        out_odi = [odi[0] / mean_scale, odi[1] / mean_scale, odi[2] / mean_scale];
                        fit_succeeded = true;
                    }
                }
            }
        }
    } else if fit_mode == "scale" {
        // Offsets + Scale
        if fit_mot {
            let mut a_mat = [[0.0f64; 7]; 7];
            let mut b_vec = [0.0f64; 7];
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;
                let t = points[j].motor_val;

                let rows: [[f64; 7]; 3] = [
                    [1.0, 0.0, 0.0, r[0], t,   0.0, 0.0],
                    [0.0, 1.0, 0.0, r[1], 0.0, t,   0.0],
                    [0.0, 0.0, 1.0, r[2], 0.0, 0.0, t  ],
                ];
                for row_idx in 0..3 {
                    let a_row = rows[row_idx];
                    let b_val = e[row_idx];
                    for r_i in 0..7 {
                        b_vec[r_i] += w * a_row[r_i] * b_val;
                        for c_i in 0..7 {
                            a_mat[r_i][c_i] += w * a_row[r_i] * a_row[c_i];
                        }
                    }
                }
            }
            if let Some(sol) = solve_linear_system(a_mat, b_vec) {
                let s = sol[3];
                if s.abs() > 0.1 {
                    out_scale = s;
                    out_ofs = [sol[0] / s, sol[1] / s, sol[2] / s];
                    out_mot = [sol[4], sol[5], sol[6]];
                    fit_succeeded = true;
                }
            }
        } else {
            let mut a_mat = [[0.0f64; 4]; 4];
            let mut b_vec = [0.0f64; 4];
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;

                let rows: [[f64; 4]; 3] = [
                    [1.0, 0.0, 0.0, r[0]],
                    [0.0, 1.0, 0.0, r[1]],
                    [0.0, 0.0, 1.0, r[2]],
                ];
                for row_idx in 0..3 {
                    let a_row = rows[row_idx];
                    let b_val = e[row_idx];
                    for r_i in 0..4 {
                        b_vec[r_i] += w * a_row[r_i] * b_val;
                        for c_i in 0..4 {
                            a_mat[r_i][c_i] += w * a_row[r_i] * a_row[c_i];
                        }
                    }
                }
            }
            if let Some(sol) = solve_linear_system(a_mat, b_vec) {
                let s = sol[3];
                if s.abs() > 0.1 {
                    out_scale = s;
                    out_ofs = [sol[0] / s, sol[1] / s, sol[2] / s];
                    fit_succeeded = true;
                }
            }
        }
    }

    if !fit_succeeded {
        // Offsets only (or fallback if iron/scale was ill-conditioned)
        if fit_mot {
            let mut a_mat = [[0.0f64; 6]; 6];
            let mut b_vec = [0.0f64; 6];
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;
                let t = points[j].motor_val;

                let diff = [e[0] - r[0], e[1] - r[1], e[2] - r[2]];
                let rows: [[f64; 6]; 3] = [
                    [1.0, 0.0, 0.0, t,   0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0, t,   0.0],
                    [0.0, 0.0, 1.0, 0.0, 0.0, t  ],
                ];
                for row_idx in 0..3 {
                    let a_row = rows[row_idx];
                    let b_val = diff[row_idx];
                    for r_i in 0..6 {
                        b_vec[r_i] += w * a_row[r_i] * b_val;
                        for c_i in 0..6 {
                            a_mat[r_i][c_i] += w * a_row[r_i] * a_row[c_i];
                        }
                    }
                }
            }
            if let Some(sol) = solve_linear_system(a_mat, b_vec) {
                out_ofs = [sol[0], sol[1], sol[2]];
                out_mot = [sol[3], sol[4], sol[5]];
                fit_succeeded = true;
            }
        } else {
            let mut ofs_sum = [0.0; 3];
            let mut w_sum = 0.0;
            for j in 0..n {
                let w = weights[j];
                let r = body_raw[j];
                let e = points[j].expected;
                ofs_sum[0] += w * (e[0] - r[0]);
                ofs_sum[1] += w * (e[1] - r[1]);
                ofs_sum[2] += w * (e[2] - r[2]);
                w_sum += w;
            }
            if w_sum > 0.0 {
                out_ofs = [ofs_sum[0] / w_sum, ofs_sum[1] / w_sum, ofs_sum[2] / w_sum];
                fit_succeeded = true;
            }
        }
    }

    if !fit_succeeded {
        return json!({ "ok": false, "error": "Singular matrix: insufficient variance in magnetic measurements to solve calibration." });
    }

    // 10. Evaluate Fitted Error
    let mut fit_err_sq = 0.0;
    let mut worst_point_us = 0u64;
    let mut max_point_err = 0.0f64;
    for j in 0..n {
        let r = body_raw[j];
        let ex = points[j].expected;
        let t = points[j].motor_val;

        // Apply offsets
        let mut x = r[0] + out_ofs[0];
        let mut y = r[1] + out_ofs[1];
        let mut z = r[2] + out_ofs[2];

        // Apply scale
        x *= out_scale;
        y *= out_scale;
        z *= out_scale;

        // Apply iron matrix
        let cx = x * out_dia[0] + y * out_odi[0] + z * out_odi[1];
        let cy = x * out_odi[0] + y * out_dia[1] + z * out_odi[2];
        let cz = x * out_odi[1] + y * out_odi[2] + z * out_dia[2];

        // Apply motor
        let fx = cx + t * out_mot[0];
        let fy = cy + t * out_mot[1];
        let fz = cz + t * out_mot[2];

        let d = (fx - ex[0]).powi(2) + (fy - ex[1]).powi(2) + (fz - ex[2]).powi(2);
        let err = d.sqrt();
        if err > max_point_err {
            max_point_err = err;
            worst_point_us = points[j].us;
        }
        fit_err_sq += weights[j] * d;
    }
    let fit_error_mgauss = ((fit_err_sq / n as f64).sqrt() * 10.0).round() / 10.0;
    let reduction_pct = if orig_error_mgauss > 0.01 {
        (((orig_error_mgauss - fit_error_mgauss) / orig_error_mgauss) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    // Format parameter map with exact ArduPilot parameter names:
    let mut params_map = serde_json::Map::new();
    let round2 = |v: f64| (v * 100.0).round() / 100.0;
    let round3 = |v: f64| (v * 1000.0).round() / 1000.0;

    params_map.insert(format!("COMPASS_OFS{}_X", stem_num), json!(round2(out_ofs[0])));
    params_map.insert(format!("COMPASS_OFS{}_Y", stem_num), json!(round2(out_ofs[1])));
    params_map.insert(format!("COMPASS_OFS{}_Z", stem_num), json!(round2(out_ofs[2])));

    if fit_mode == "iron" {
        params_map.insert(format!("COMPASS_DIA{}_X", stem_num), json!(round3(out_dia[0])));
        params_map.insert(format!("COMPASS_DIA{}_Y", stem_num), json!(round3(out_dia[1])));
        params_map.insert(format!("COMPASS_DIA{}_Z", stem_num), json!(round3(out_dia[2])));

        params_map.insert(format!("COMPASS_ODI{}_X", stem_num), json!(round3(out_odi[0])));
        params_map.insert(format!("COMPASS_ODI{}_Y", stem_num), json!(round3(out_odi[1])));
        params_map.insert(format!("COMPASS_ODI{}_Z", stem_num), json!(round3(out_odi[2])));
    }

    if fit_mode == "iron" || fit_mode == "scale" {
        params_map.insert(format!("COMPASS_SCALE{}", stem_num), json!(round3(out_scale)));
    }

    if fit_mot {
        params_map.insert(format!("COMPASS_MOT{}_X", stem_num), json!(round2(out_mot[0])));
        params_map.insert(format!("COMPASS_MOT{}_Y", stem_num), json!(round2(out_mot[1])));
        params_map.insert(format!("COMPASS_MOT{}_Z", stem_num), json!(round2(out_mot[2])));
    }

    if effective_orientation != logged_params.orientation {
        params_map.insert(format!("COMPASS_ORIENT{}", stem_num), json!(effective_orientation));
    }

    let mut key_intervals = BTreeMap::new();
    if max_curr_us > 0 && max_curr > 5.0 {
        key_intervals.insert("max_current".to_string(), json!({
            "start_us": max_curr_us.saturating_sub(3_000_000),
            "end_us": max_curr_us + 3_000_000,
            "max_current_a": (max_curr * 10.0).round() / 10.0
        }));
    }
    if worst_point_us > 0 {
        key_intervals.insert("worst_fit_anomaly".to_string(), json!({
            "start_us": worst_point_us.saturating_sub(2_000_000),
            "end_us": worst_point_us + 2_000_000,
            "error_mgauss": (max_point_err * 10.0).round() / 10.0
        }));
    }

    let suggested_chart = if max_curr_us > 0 && max_curr > 5.0 {
        json!({
            "title": format!("Compass {} Field Under Peak Current ({:.1} A)", compass_idx, max_curr),
            "start_us": max_curr_us.saturating_sub(4_000_000),
            "end_us": max_curr_us + 4_000_000,
            "axes": [
                {
                    "label": "mGauss",
                    "lines": [
                        { "message": target_msg_name.clone(), "field": "MagX", "name": "MagX" },
                        { "message": target_msg_name.clone(), "field": "MagY", "name": "MagY" },
                        { "message": target_msg_name.clone(), "field": "MagZ", "name": "MagZ" }
                    ]
                },
                {
                    "label": "Amps",
                    "lines": [
                        { "message": "BAT", "field": "Curr", "name": "Current (A)" }
                    ]
                }
            ]
        })
    } else {
        let chart_end = if last_mag_us > first_mag_us { (first_mag_us + 12_000_000).min(last_mag_us) } else { first_mag_us + 12_000_000 };
        json!({
            "title": format!("Compass {} Raw Field & Vehicle Yaw", compass_idx),
            "start_us": first_mag_us,
            "end_us": chart_end,
            "axes": [
                {
                    "label": "mGauss",
                    "lines": [
                        { "message": target_msg_name.clone(), "field": "MagX", "name": "MagX" },
                        { "message": target_msg_name.clone(), "field": "MagY", "name": "MagY" },
                        { "message": target_msg_name.clone(), "field": "MagZ", "name": "MagZ" }
                    ]
                },
                {
                    "label": "deg",
                    "lines": [
                        { "message": "ATT", "field": "Yaw", "name": "Vehicle Yaw" }
                    ]
                }
            ]
        })
    };

    json!({
        "ok": true,
        "compass": compass_idx,
        "key_intervals": Value::Object(key_intervals.into_iter().collect()),
        "analyzed_interval": {
            "start_us": first_mag_us,
            "end_us": last_mag_us
        },
        "suggested_chart": suggested_chart,
        "fit_type": fit_mode,
        "samples": n,
        "coordinates": {
            "lat": lat_deg,
            "lon": lon_deg,
            "source": coord_source
        },
        "coverage_pct": coverage_pct,
        "orig_error_mgauss": orig_error_mgauss,
        "fit_error_mgauss": fit_error_mgauss,
        "reduction_pct": reduction_pct,
        "orientation": orient_result,
        "params": Value::Object(params_map),
        "note": concat!(
            "orig_error_mgauss is the field residual with the calibration active in the flight. ",
            "fit_error_mgauss is the residual error with the newly calculated parameters. ",
            "reduction_pct is the error reduction. ",
            "coverage_pct is the spherical attitude coverage score (80-bin Fibonacci lattice). ",
            "orientation states whether the logged COMPASS_ORIENT matches the best-fit rotation."
        )
    })
}

/// Public API called by agent or catalog.
pub fn magfit(
    id: &str,
    compass: Option<usize>,
    fit_type: Option<&str>,
    motor_comp: Option<&str>,
    check_orientation: Option<bool>,
    start_us: Option<u64>,
    end_us: Option<u64>,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Value {
    let bytes = match read_id(id) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    magfit_bytes(
        &bytes,
        compass.unwrap_or(1),
        fit_type.unwrap_or("iron"),
        motor_comp.unwrap_or("none"),
        check_orientation.unwrap_or(true),
        start_us,
        end_us,
        lat,
        lon,
    )
}
