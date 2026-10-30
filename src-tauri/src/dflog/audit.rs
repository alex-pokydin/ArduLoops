// Hardware report, crash detection and flight safety diagnostics from DataFlash logs.

/// Summary of an identified safety issue.
#[derive(Clone, Debug, serde::Serialize)]
pub struct AuditIssue {
    pub severity: String, // "critical", "warning", "info"
    pub category: String, // "vibration", "power", "ekf", "crash", "hardware", "gps", "motors", "safety"
    pub message: String,
    pub recommendation: String,
}

pub fn audit_bytes(bytes: &[u8]) -> Value {
    let formats = parse_formats(bytes);
    if formats.is_empty() {
        return json!({ "ok": false, "error": "No message format headers found in log" });
    }

    let mut firmware_version = String::new();
    let mut frame_type = String::new();
    let mut parms: BTreeMap<String, f64> = BTreeMap::new();
    let mut messages: Vec<String> = Vec::new();

    // Arming state tracking
    let mut is_armed = false;
    let mut first_armed_us = 0u64;
    let mut last_disarmed_us = 0u64;
    let mut armed_time_total_us = 0u64;
    let mut last_armed_start_us = 0u64;

    // Vibrations & clipping
    let mut max_vibe_x = 0.0f64;
    let mut max_vibe_y = 0.0f64;
    let mut max_vibe_z = 0.0f64;
    let mut worst_vibe_us = 0u64;
    let mut max_clip0 = 0u64;
    let mut max_clip1 = 0u64;
    let mut max_clip2 = 0u64;
    let mut last_clip_sum = 0u64;
    let mut worst_clip_us = 0u64;

    // Power (5V rail Vcc & Battery)
    let mut min_vcc = 100.0f64;
    let mut max_vcc = 0.0f64;
    let mut min_vcc_us = 0u64;
    let mut sum_vcc = 0.0f64;
    let mut count_vcc = 0usize;
    let mut min_batt_v = 100.0f64;
    let mut min_batt_v_armed = 100.0f64;
    let mut max_batt_curr = 0.0f64;

    // GPS (tracked overall and in-flight while armed)
    let mut overall_lowest_fix = 10u64;
    let mut armed_min_fix = 10u64;
    let mut armed_min_sats = 100u64;
    let mut armed_max_hdop = 0.0f64;
    let mut first_gps_degrade_us = 0u64;
    let mut had_gps_fix_armed = false;
    let mut gps_glitches = 0usize;

    // EKF metrics and events
    let mut first_ekf_spike_us = 0u64;
    let mut max_ekf_ratio = 0.0f64;
    let mut max_ekf_vel = 0.0f64;
    let mut max_ekf_pos = 0.0f64;
    let mut max_ekf_hgt = 0.0f64;
    let mut max_ekf_mag = 0.0f64;
    let mut ekf_lane_switches = Vec::new();
    let mut ekf_errors = 0usize;
    let mut ekf_failsafes = 0usize;
    let mut ekf_yaw_resets = 0usize;
    let mut ekf_alt_resets = 0usize;

    // Motors & actuators
    let mut motor_saturation_count = 0usize;
    let mut first_motor_saturation_us = 0u64;
    let mut hover_throttle_sum = 0.0f64;
    let mut hover_throttle_count = 0usize;
    let mut mot_thh = None;

    // Crash & Watchdog
    let mut crash_detected = false;
    let mut crash_time_us = None;
    let mut watchdog_reset = false;

    // Event & error timelines
    let mut events: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    let mut modes: Vec<(u64, String)> = Vec::new();

    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let us = time_us(fmt, values).unwrap_or(0);

        if fmt.name == "MSG" {
            if let Some(msg) = field_str(fmt, values, "Message") {
                if firmware_version.is_empty() && (msg.contains("Ardu") || msg.contains("V4.") || msg.contains("V3.")) {
                    firmware_version = msg.clone();
                }
                if frame_type.is_empty() && (msg.contains("Frame") || msg.contains("QUAD") || msg.contains("HEXA") || msg.contains("OCTA") || msg.contains("HELI") || msg.contains("PLANE") || msg.contains("ROVER")) {
                    frame_type = msg.clone();
                }
                if msg.contains("lane switch") || msg.contains("primary changed") {
                    ekf_errors += 1;
                    ekf_lane_switches.push(json!({ "time_us": us, "text": msg }));
                    if first_ekf_spike_us == 0 && us > 0 { first_ekf_spike_us = us; }
                }
                if messages.len() < 30 {
                    messages.push(msg);
                }
            }
        } else if fmt.name == "PARM" {
            if let (Some(name), Some(val)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                parms.insert(name, val);
            }
        } else if fmt.name == "ARM" {
            if let Some(state) = field_u64(fmt, values, "ArmState") {
                if state == 1 && !is_armed {
                    is_armed = true;
                    last_armed_start_us = us;
                    if first_armed_us == 0 { first_armed_us = us; }
                } else if state == 0 && is_armed {
                    is_armed = false;
                    last_disarmed_us = us;
                    if last_armed_start_us > 0 {
                        armed_time_total_us += us.saturating_sub(last_armed_start_us);
                    }
                }
            }
        } else if fmt.name == "EV" {
            let id = field_u64(fmt, values, "Id").unwrap_or(0);
            let name = match id {
                10 => {
                    if !is_armed {
                        is_armed = true;
                        last_armed_start_us = us;
                        if first_armed_us == 0 { first_armed_us = us; }
                    }
                    "Armed"
                },
                11 => {
                    if is_armed {
                        is_armed = false;
                        last_disarmed_us = us;
                        if last_armed_start_us > 0 {
                            armed_time_total_us += us.saturating_sub(last_armed_start_us);
                        }
                    }
                    "Disarmed"
                },
                15 => {
                    if !is_armed {
                        is_armed = true;
                        last_armed_start_us = us;
                        if first_armed_us == 0 { first_armed_us = us; }
                    }
                    "AutoArmed"
                },
                17 => "LandCompleteMaybe",
                18 => "LandComplete",
                19 => {
                    gps_glitches += 1;
                    "LostGPS"
                },
                24 => {
                    crash_detected = true;
                    crash_time_us = Some(us);
                    "CrashDetected"
                },
                25 => "SetHome",
                28 => "NotLanded",
                30 => "AutoTuneInitialised",
                31 => "AutoTuneOff",
                33 => "AutoTuneSuccess",
                34 => "AutoTuneFailed",
                51 => "ParachuteReleased",
                54 => "MotorsEmergencyStopped",
                56 => "MotorsInterlockDisabled",
                57 => "MotorsInterlockEnabled",
                60 => {
                    ekf_alt_resets += 1;
                    "EKFAltReset"
                },
                62 => {
                    ekf_yaw_resets += 1;
                    if first_ekf_spike_us == 0 && us > 0 {
                        first_ekf_spike_us = us;
                    }
                    "EKFYawReset"
                },
                67 => "GPSPrimaryChanged",
                85 => "EK3SourcesSetToPrimary",
                86 => "EK3SourcesSetToSecondary",
                _ => "Event",
            };
            if events.len() < 30 {
                events.push(json!({ "time_us": us, "id": id, "name": name }));
            }
        } else if fmt.name == "VIBE" {
            let mut v_peak = 0.0f64;
            if let Some(x) = field_f64(fmt, values, "VibeX") { max_vibe_x = max_vibe_x.max(x); v_peak = v_peak.max(x); }
            if let Some(y) = field_f64(fmt, values, "VibeY") { max_vibe_y = max_vibe_y.max(y); v_peak = v_peak.max(y); }
            if let Some(z) = field_f64(fmt, values, "VibeZ") { max_vibe_z = max_vibe_z.max(z); v_peak = v_peak.max(z); }
            let c0 = field_u64(fmt, values, "Clip0").unwrap_or(0);
            let c1 = field_u64(fmt, values, "Clip1").unwrap_or(0);
            let c2 = field_u64(fmt, values, "Clip2").unwrap_or(0);
            max_clip0 = max_clip0.max(c0);
            max_clip1 = max_clip1.max(c1);
            max_clip2 = max_clip2.max(c2);
            let current_clips = c0 + c1 + c2;
            if current_clips > last_clip_sum && us > 0 {
                worst_clip_us = us;
                last_clip_sum = current_clips;
            }
            if v_peak >= max_vibe_x.max(max_vibe_y).max(max_vibe_z) && us > 0 {
                worst_vibe_us = us;
            }
        } else if fmt.name == "PM" {
            if let Some(vcc) = field_f64(fmt, values, "Vcc") {
                if vcc > 2.0 && vcc < 10.0 {
                    let vcc_v = if vcc > 100.0 { vcc * 0.001 } else { vcc };
                    if vcc_v < min_vcc && us > 0 {
                        min_vcc_us = us;
                    }
                    min_vcc = min_vcc.min(vcc_v);
                    max_vcc = max_vcc.max(vcc_v);
                    sum_vcc += vcc_v;
                    count_vcc += 1;
                }
            }
        } else if fmt.name == "BAT" {
            if let Some(v) = field_f64(fmt, values, "Volt") {
                if v > 1.0 {
                    min_batt_v = min_batt_v.min(v);
                    if is_armed {
                        min_batt_v_armed = min_batt_v_armed.min(v);
                    }
                }
            }
            if let Some(c) = field_f64(fmt, values, "Curr") {
                max_batt_curr = max_batt_curr.max(c);
            }
        } else if fmt.name == "GPS" {
            let f = field_u64(fmt, values, "FixType").unwrap_or(0);
            let s = field_u64(fmt, values, "NSats").unwrap_or(0);
            let h = field_f64(fmt, values, "HDop").unwrap_or(99.0);
            if f > 0 { overall_lowest_fix = overall_lowest_fix.min(f); }

            // Evaluate in-flight GPS quality while armed (or fallback to overall if never explicitly armed)
            if is_armed || first_armed_us == 0 {
                if f > 0 { armed_min_fix = armed_min_fix.min(f); }
                if s > 0 { armed_min_sats = armed_min_sats.min(s); }
                if h > 0.0 && h < 50.0 { armed_max_hdop = armed_max_hdop.max(h); }

                if f >= 3 && s >= 8 && h < 2.0 {
                    had_gps_fix_armed = true;
                } else if had_gps_fix_armed && (f < 3 || s < 6 || h > 2.5) && first_gps_degrade_us == 0 && us > 0 {
                    first_gps_degrade_us = us;
                }
            }
        } else if fmt.name == "ERR" {
            let sub = field_u64(fmt, values, "SubSys").unwrap_or(0);
            let code = field_u64(fmt, values, "ECode").unwrap_or(0);

            let sub_name = match sub {
                1 => "Main",
                2 => "Radio",
                3 => "Compass",
                5 => "Failsafe_Radio",
                6 => "Failsafe_Batt",
                7 => "Failsafe_GPS",
                8 => "Failsafe_GCS",
                9 => "Failsafe_Fence",
                10 => "Flight_Mode",
                11 => "GPS",
                12 => {
                    crash_detected = true;
                    if crash_time_us.is_none() { crash_time_us = Some(us); }
                    "Crash_Check"
                },
                15 => "Parachutes",
                16 => {
                    ekf_errors += 1;
                    if first_ekf_spike_us == 0 && us > 0 { first_ekf_spike_us = us; }
                    "EKF_Check"
                },
                17 => {
                    ekf_failsafes += 1;
                    if first_ekf_spike_us == 0 && us > 0 { first_ekf_spike_us = us; }
                    "Failsafe_EKF_INAV"
                },
                18 => "Baro",
                19 => "CPU",
                20 => "Failsafe_ADSB",
                21 => "Terrain",
                22 => "Navigation",
                24 => {
                    ekf_errors += 1;
                    if first_ekf_spike_us == 0 && us > 0 { first_ekf_spike_us = us; }
                    ekf_lane_switches.push(json!({ "time_us": us, "new_core": code }));
                    "EKF_Primary"
                },
                25 => "Thrust_Loss_Check",
                26 => "Failsafe_Sensors",
                29 => "Failsafe_Vibe",
                30 => "Internal_Error",
                _ => "Other",
            };

            if errors.len() < 25 {
                errors.push(json!({ "time_us": us, "subsys": sub_name, "code": code }));
            }
        } else if fmt.name == "XKF4" || fmt.name == "NKF4" || fmt.name == "EKF4" {
            let sv = field_f64(fmt, values, "SV").unwrap_or(0.0);
            let sp = field_f64(fmt, values, "SP").unwrap_or(0.0);
            let sh = field_f64(fmt, values, "SH").unwrap_or(0.0);
            let sm = field_f64(fmt, values, "SM").unwrap_or(0.0);

            max_ekf_vel = max_ekf_vel.max(sv);
            max_ekf_pos = max_ekf_pos.max(sp);
            max_ekf_hgt = max_ekf_hgt.max(sh);
            max_ekf_mag = max_ekf_mag.max(sm);

            let ratio = sv.max(sp).max(sh).max(sm);
            if ratio > 1.0 {
                max_ekf_ratio = max_ekf_ratio.max(ratio);
                if first_ekf_spike_us == 0 && us > 0 {
                    first_ekf_spike_us = us;
                }
            }
        } else if fmt.name == "RCOU" {
            // Check motor saturation while armed
            if is_armed || first_armed_us == 0 {
                let mut sum_pwm = 0.0f64;
                let mut active_count = 0usize;
                for i in 1..=8 {
                    let col = format!("C{}", i);
                    if let Some(v) = field_f64(fmt, values, &col) {
                        if v > 900.0 && v < 2200.0 {
                            if v >= 1950.0 {
                                motor_saturation_count += 1;
                                if first_motor_saturation_us == 0 && us > 0 {
                                    first_motor_saturation_us = us;
                                }
                            }
                            sum_pwm += v;
                            active_count += 1;
                        }
                    }
                }
                if active_count >= 3 {
                    let avg = sum_pwm / active_count as f64;
                    if avg > 1150.0 {
                        hover_throttle_sum += avg;
                        hover_throttle_count += 1;
                    }
                }
            }
        } else if fmt.name == "MOT" {
            if let Some(thh) = field_f64(fmt, values, "ThH") {
                if thh > 0.05 && thh < 1.0 {
                    mot_thh = Some(thh);
                }
            }
        } else if fmt.name == "WDOG" {
            watchdog_reset = true;
        } else if fmt.name == "MODE" {
            if let Some(mode) = field_str(fmt, values, "Mode") {
                if modes.last().map(|m| &m.1) != Some(&mode) {
                    modes.push((us, mode));
                }
            }
        }
    }, &mut incomplete);

    // Finalize armed time
    if is_armed && last_armed_start_us > 0 {
        armed_time_total_us += last_disarmed_us.max(last_armed_start_us).saturating_sub(last_armed_start_us);
    }

    // Identify servo functions
    let mut servo_motors = Vec::new();
    for i in 1..=16 {
        let key = format!("SERVO{}_FUNCTION", i);
        if let Some(&fn_val) = parms.get(&key) {
            let f = fn_val as u32;
            if (33..=40).contains(&f) {
                servo_motors.push(json!({ "channel": i, "motor": f - 32 }));
            }
        }
    }

    let _avg_vcc = if count_vcc > 0 { sum_vcc / count_vcc as f64 } else { 5.0 };
    let vcc_ripple = if max_vcc >= min_vcc && count_vcc > 0 { max_vcc - min_vcc } else { 0.0 };

    // Diagnostic verdict and issues list
    let mut issues: Vec<AuditIssue> = Vec::new();

    // 1. Crash
    if crash_detected {
        issues.push(AuditIssue {
            severity: "critical".into(),
            category: "crash".into(),
            message: format!("Crash detected by autopilot at TimeUS {}.", crash_time_us.unwrap_or(0)),
            recommendation: "Inspect log leading up to this timestamp for motor failure, battery brownout, or EKF disorientation.".into(),
        });
    }

    // 2. Watchdog
    if watchdog_reset {
        issues.push(AuditIssue {
            severity: "critical".into(),
            category: "hardware".into(),
            message: "Watchdog reset (WDOG) logged during operation.".into(),
            recommendation: "Firmware hung or high-priority task starved CPU. Check CPU load, loop times and update firmware.".into(),
        });
    }

    // 3. Vibrations & Clipping
    let total_clips = max_clip0 + max_clip1 + max_clip2;
    if total_clips > 100 {
        issues.push(AuditIssue {
            severity: "critical".into(),
            category: "vibration".into(),
            message: format!("Severe accelerometer clipping detected: {} total clips (Clip0: {}, Clip1: {}, Clip2: {}).", total_clips, max_clip0, max_clip1, max_clip2),
            recommendation: "Accelerometers saturated (>16G/24G). EKF altitude and attitude estimates become unreliable. Balance propellers and inspect flight controller dampening.".into(),
        });
    } else if total_clips > 0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "vibration".into(),
            message: format!("Minor accelerometer clipping: {} clips.", total_clips),
            recommendation: "Occasional clipping during hard maneuvers or landing. Check propeller balance and motor bearings.".into(),
        });
    }

    let max_vibe = max_vibe_x.max(max_vibe_y).max(max_vibe_z);
    if max_vibe > 60.0 {
        issues.push(AuditIssue {
            severity: "critical".into(),
            category: "vibration".into(),
            message: format!("Dangerous vibration levels: {:.1} m/s^2 (X: {:.1}, Y: {:.1}, Z: {:.1}; limit 30 m/s^2).", max_vibe, max_vibe_x, max_vibe_y, max_vibe_z),
            recommendation: "Vibrations exceed 60 m/s^2. Autopilot navigation may degrade. Mechanically isolate the flight controller or balance props.".into(),
        });
    } else if max_vibe > 30.0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "vibration".into(),
            message: format!("Elevated vibrations: {:.1} m/s^2 (recommended < 30 m/s^2).", max_vibe),
            recommendation: "Vibrations are higher than recommended. Check frame rigidity and enable harmonic notch filtering.".into(),
        });
    }

    // 4. Power Subsystem
    if count_vcc > 0 {
        if min_vcc < 4.60 {
            issues.push(AuditIssue {
                severity: "critical".into(),
                category: "power".into(),
                message: format!("Critical 5V rail brownout: Vcc dropped to {:.2}V (nominal 5.0V, safe minimum 4.85V).", min_vcc),
                recommendation: "Immediate risk of processor reboot. Replace power module or reduce 5V servo / accessory current draw.".into(),
            });
        } else if min_vcc < 4.80 || vcc_ripple > 0.35 {
            issues.push(AuditIssue {
                severity: "warning".into(),
                category: "power".into(),
                message: format!("Suboptimal 5V rail power: Vcc minimum {:.2}V, ripple {:.2}V.", min_vcc, vcc_ripple),
                recommendation: "5V rail fluctuates under load. Verify power module wiring and capacitor decoupling.".into(),
            });
        }
    }

    // 5. EKF Health, Innovations & Lane Switches
    if ekf_failsafes > 0 {
        issues.push(AuditIssue {
            severity: "critical".into(),
            category: "ekf".into(),
            message: format!("EKF failsafe triggered in flight (logged {} time(s)). Autonomous navigation lost.", ekf_failsafes),
            recommendation: "Investigate sensor disagreement. High risk of flyaway. Inspect GPS glitches, compass magnetic anomalies, and IMU clipping.".into(),
        });
    }

    if !ekf_lane_switches.is_empty() {
        let mut causes = Vec::new();
        if max_ekf_mag > 1.0 { causes.push(format!("Compass (variance {:.1})", max_ekf_mag)); }
        if max_ekf_vel > 1.0 { causes.push(format!("Velocity (variance {:.1})", max_ekf_vel)); }
        if max_ekf_pos > 1.0 { causes.push(format!("Position (variance {:.1})", max_ekf_pos)); }
        if max_ekf_hgt > 1.0 { causes.push(format!("Height (variance {:.1})", max_ekf_hgt)); }
        let cause_str = if causes.is_empty() { "Sensor/IMU inconsistency".to_string() } else { causes.join(", ") };

        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "ekf".into(),
            message: format!("EKF primary core switched {} time(s). Primary innovation source: {}.", ekf_lane_switches.len(), cause_str),
            recommendation: "Compare primary vs secondary IMU and compass signals. Calibrate compasses or isolate magnetic interference.".into(),
        });
    } else if ekf_errors > 0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "ekf".into(),
            message: format!("EKF logged {} subsystem check events.", ekf_errors),
            recommendation: "Check compass variance, GPS quality, and accelerometer vibrations.".into(),
        });
    }

    if max_ekf_ratio > 1.0 && ekf_lane_switches.is_empty() && ekf_failsafes == 0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "ekf".into(),
            message: format!("EKF innovation variance spiked to {:.1} (limit 1.0).", max_ekf_ratio),
            recommendation: "Innovation exceeded normal gating. Check for magnetic interference under high motor current or GPS speed jumps.".into(),
        });
    }

    if ekf_yaw_resets > 0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "ekf".into(),
            message: format!("EKF performed {} in-flight yaw reset(s).", ekf_yaw_resets),
            recommendation: "Autopilot re-aligned heading to compass. Indicates strong magnetic distortion or gyro yaw drift.".into(),
        });
    }

    // 6. In-flight GPS (Armed window)
    if armed_min_fix < 3 && armed_min_fix != 10 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "gps".into(),
            message: format!("GPS fix lost or degraded during armed flight (minimum fix type: {}, min sats: {}).", armed_min_fix, if armed_min_sats == 100 { 0 } else { armed_min_sats }),
            recommendation: "Autonomous modes (Loiter, RTL, Auto) require reliable 3D Fix (type >= 3) and HDop < 1.5. Ensure clear view of sky.".into(),
        });
    } else if armed_max_hdop > 2.0 && armed_max_hdop < 50.0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "gps".into(),
            message: format!("Elevated in-flight GPS HDop: peaked at {:.1} (recommended < 1.5, min sats: {}).", armed_max_hdop, armed_min_sats),
            recommendation: "Poor satellite geometry during flight degrades horizontal hold accuracy.".into(),
        });
    }

    // 7. Motor Saturation & Thrust Headroom
    if motor_saturation_count > 10 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "motors".into(),
            message: format!("Motor output saturation detected: {} samples at maximum output (>= 1950 us).", motor_saturation_count),
            recommendation: "Actuators hit ceiling. Attitude control authority compromised during full throttle or high-wind maneuvers.".into(),
        });
    }

    let estimated_hover_pct = if let Some(thh) = mot_thh {
        ((thh * 100.0) * 10.0).round() / 10.0
    } else if hover_throttle_count > 0 {
        let avg_pwm = hover_throttle_sum / hover_throttle_count as f64;
        let pct = ((avg_pwm - 1000.0) / 10.0).clamp(0.0, 100.0);
        (pct * 10.0).round() / 10.0
    } else {
        0.0
    };

    if estimated_hover_pct > 65.0 {
        issues.push(AuditIssue {
            severity: "warning".into(),
            category: "motors".into(),
            message: format!("High estimated hover throttle ({:.1}%). Low thrust-to-weight margin.", estimated_hover_pct),
            recommendation: "Multirotor requires >35% thrust margin to recover from descents and fight wind gusts. Reduce takeoff weight or upgrade propulsion.".into(),
        });
    }

    // 8. Safety Configuration Parameters (AMC / ardupilot-mcp alignment)
    if let Some(&ac) = parms.get("ARMING_CHECK") {
        if ac == 0.0 {
            issues.push(AuditIssue {
                severity: "warning".into(),
                category: "safety".into(),
                message: "Arming checks are completely disabled (ARMING_CHECK = 0).".into(),
                recommendation: "Pre-arm hardware and sensor safety checks are bypassed. Enable ARMING_CHECK = 1 for safe operation.".into(),
            });
        }
    }
    if let Some(&fs_act) = parms.get("BATT_FS_LOW_ACT") {
        let bmon = parms.get("BATT_MONITOR").copied().unwrap_or(0.0);
        if bmon > 0.0 && fs_act == 0.0 {
            issues.push(AuditIssue {
                severity: "warning".into(),
                category: "safety".into(),
                message: "Low battery failsafe action is disabled (BATT_FS_LOW_ACT = 0).".into(),
                recommendation: "Autopilot will not automatically RTL or Land when battery depletes. Configure a non-zero failsafe action.".into(),
            });
        }
    }
    if let Some(&fs_thr) = parms.get("FS_THR_ENABLE") {
        if fs_thr == 0.0 {
            issues.push(AuditIssue {
                severity: "warning".into(),
                category: "safety".into(),
                message: "Radio throttle loss failsafe is disabled (FS_THR_ENABLE = 0).".into(),
                recommendation: "Loss of RC signal will not trigger RTL. Enable FS_THR_ENABLE = 1 to prevent lost-link flyaways.".into(),
            });
        }
    }

    // Compute deterministic Health Score (0..100)
    let mut score = 100i32;
    for issue in &issues {
        if issue.severity == "critical" {
            score -= 30;
        } else if issue.severity == "warning" {
            score -= 10;
        }
    }
    let health_score = score.clamp(0, 100) as u32;
    let overall_health = if health_score >= 85 && !crash_detected {
        "PASS"
    } else if health_score >= 60 && !crash_detected {
        "WARN"
    } else {
        "FAIL"
    };

    let is_safe = !issues.iter().any(|i| i.severity == "critical");

    // Key timeline intervals for graphing
    let mut key_intervals = BTreeMap::new();
    if worst_vibe_us > 0 {
        key_intervals.insert("vibration_peak".to_string(), json!({
            "start_us": worst_vibe_us.saturating_sub(3_000_000),
            "end_us": worst_vibe_us + 3_000_000,
            "peak_vibe_ms2": (max_vibe * 10.0).round() / 10.0
        }));
    }
    if worst_clip_us > 0 && total_clips > 0 {
        key_intervals.insert("clipping_event".to_string(), json!({
            "start_us": worst_clip_us.saturating_sub(3_000_000),
            "end_us": worst_clip_us + 3_000_000,
            "total_clips": total_clips
        }));
    }
    if first_ekf_spike_us > 0 {
        key_intervals.insert("ekf_spike".to_string(), json!({
            "start_us": first_ekf_spike_us.saturating_sub(3_000_000),
            "end_us": first_ekf_spike_us + 3_000_000,
            "max_ratio": if max_ekf_ratio > 0.0 { Some((max_ekf_ratio * 10.0).round() / 10.0) } else { None }
        }));
    }
    if first_gps_degrade_us > 0 {
        key_intervals.insert("gps_degradation".to_string(), json!({
            "start_us": first_gps_degrade_us.saturating_sub(3_000_000),
            "end_us": first_gps_degrade_us + 3_000_000,
            "lowest_fix": if armed_min_fix == 10 { overall_lowest_fix } else { armed_min_fix },
            "min_sats": if armed_min_sats == 100 { 0 } else { armed_min_sats }
        }));
    }
    if min_vcc_us > 0 && min_vcc < 4.85 {
        key_intervals.insert("power_dip".to_string(), json!({
            "start_us": min_vcc_us.saturating_sub(3_000_000),
            "end_us": min_vcc_us + 3_000_000,
            "min_vcc_v": (min_vcc * 100.0).round() / 100.0
        }));
    }
    if first_motor_saturation_us > 0 {
        key_intervals.insert("motor_saturation".to_string(), json!({
            "start_us": first_motor_saturation_us.saturating_sub(3_000_000),
            "end_us": first_motor_saturation_us + 3_000_000,
            "saturation_count": motor_saturation_count
        }));
    }
    if let Some(ct) = crash_time_us {
        key_intervals.insert("crash_event".to_string(), json!({
            "start_us": ct.saturating_sub(5_000_000),
            "end_us": ct + 3_000_000,
            "time_us": ct
        }));
    }

    let suggested_chart = if let Some(ct) = crash_time_us {
        json!({
            "title": "Flight Attitude Leading to Crash",
            "start_us": ct.saturating_sub(5_000_000),
            "end_us": ct + 2_000_000,
            "axes": [{
                "label": "deg",
                "lines": [
                    { "message": "ATT", "field": "Roll", "name": "Roll (deg)" },
                    { "message": "ATT", "field": "Pitch", "name": "Pitch (deg)" }
                ]
            }]
        })
    } else if total_clips > 0 || max_vibe > 30.0 {
        let t = if worst_vibe_us > 0 { worst_vibe_us } else { 3_000_000 };
        json!({
            "title": "Peak Vibration Profile (IMU)",
            "start_us": t.saturating_sub(3_000_000),
            "end_us": t + 3_000_000,
            "axes": [{
                "label": "m/s/s",
                "lines": [
                    { "message": "VIBE", "field": "VibeX", "name": "Vibe X" },
                    { "message": "VIBE", "field": "VibeY", "name": "Vibe Y" },
                    { "message": "VIBE", "field": "VibeZ", "name": "Vibe Z" }
                ]
            }]
        })
    } else {
        json!({
            "title": "5V Rail Voltage & Current",
            "start_us": if min_vcc_us > 0 { min_vcc_us.saturating_sub(5_000_000) } else { 0 },
            "end_us": if min_vcc_us > 0 { min_vcc_us + 5_000_000 } else { 10_000_000 },
            "axes": [
                {
                    "label": "Volts",
                    "lines": [{ "message": "PM", "field": "Vcc", "name": "Vcc 5V" }]
                },
                {
                    "label": "Amps",
                    "lines": [{ "message": "BAT", "field": "Curr", "name": "Current" }]
                }
            ]
        })
    };

    // Subsystem status helper
    let cat_status = |cat: &str| -> (&'static str, String) {
        let cat_issues: Vec<&AuditIssue> = issues.iter().filter(|i| i.category == cat).collect();
        if cat_issues.iter().any(|i| i.severity == "critical") {
            ("FAIL", cat_issues[0].message.clone())
        } else if !cat_issues.is_empty() {
            ("WARN", cat_issues[0].message.clone())
        } else {
            ("PASS", "Nominal".to_string())
        }
    };

    let (vibe_status, vibe_summary) = cat_status("vibration");
    let (ekf_status, ekf_summary) = cat_status("ekf");
    let (power_status, power_summary) = cat_status("power");
    let (gps_status, gps_summary) = cat_status("gps");
    let (motors_status, motors_summary) = cat_status("motors");
    let (safety_status, safety_summary) = cat_status("safety");

    json!({
        "ok": true,
        "health": {
            "score": health_score,
            "status": overall_health,
            "categories": {
                "vibrations": { "status": vibe_status, "summary": vibe_summary },
                "ekf": { "status": ekf_status, "summary": ekf_summary },
                "power": { "status": power_status, "summary": power_summary },
                "gps": { "status": gps_status, "summary": gps_summary },
                "motors": { "status": motors_status, "summary": motors_summary },
                "safety_params": { "status": safety_status, "summary": safety_summary },
                "crash": { "status": if crash_detected { "FAIL" } else { "PASS" }, "summary": if crash_detected { "Crash detected" } else { "No crash logged" } }
            }
        },
        "key_intervals": Value::Object(key_intervals.into_iter().collect()),
        "suggested_chart": suggested_chart,
        "hardware": {
            "firmware": if firmware_version.is_empty() { "ArduPilot (from log)" } else { &firmware_version },
            "frame": if frame_type.is_empty() { "Generic" } else { &frame_type },
            "board_type": parms.get("BRD_TYPE").copied().unwrap_or(0.0) as u32,
            "servo_motors": servo_motors
        },
        "vibrations": {
            "vibe_x_max": (max_vibe_x * 10.0).round() / 10.0,
            "vibe_y_max": (max_vibe_y * 10.0).round() / 10.0,
            "vibe_z_max": (max_vibe_z * 10.0).round() / 10.0,
            "clip0": max_clip0,
            "clip1": max_clip1,
            "clip2": max_clip2,
            "status": if total_clips > 100 || max_vibe > 60.0 { "critical" } else if total_clips > 0 || max_vibe > 30.0 { "warning" } else { "good" }
        },
        "power": {
            "vcc_min": if count_vcc > 0 { (min_vcc * 100.0).round() / 100.0 } else { 5.0 },
            "vcc_max": if count_vcc > 0 { (max_vcc * 100.0).round() / 100.0 } else { 5.0 },
            "vcc_ripple": if count_vcc > 0 { (vcc_ripple * 100.0).round() / 100.0 } else { 0.0 },
            "battery_min_volt": if min_batt_v < 100.0 { (min_batt_v * 10.0).round() / 10.0 } else { 0.0 },
            "battery_min_volt_armed": if min_batt_v_armed < 100.0 { (min_batt_v_armed * 10.0).round() / 10.0 } else { 0.0 },
            "battery_max_curr": (max_batt_curr * 10.0).round() / 10.0,
            "status": if count_vcc > 0 && min_vcc < 4.60 { "critical" } else if count_vcc > 0 && min_vcc < 4.80 { "warning" } else { "healthy" }
        },
        "navigation": {
            "ekf_errors": ekf_errors,
            "ekf_failsafes": ekf_failsafes,
            "ekf_lane_switches": ekf_lane_switches,
            "ekf_yaw_resets": ekf_yaw_resets,
            "max_ekf_ratio": (max_ekf_ratio * 10.0).round() / 10.0,
            "max_ekf_variance": {
                "velocity": (max_ekf_vel * 10.0).round() / 10.0,
                "position": (max_ekf_pos * 10.0).round() / 10.0,
                "height": (max_ekf_hgt * 10.0).round() / 10.0,
                "magnetometer": (max_ekf_mag * 10.0).round() / 10.0,
            },
            "armed_min_gps_sats": if armed_min_sats == 100 { 0 } else { armed_min_sats },
            "armed_max_gps_hdop": (armed_max_hdop * 10.0).round() / 10.0,
            "armed_min_fix_type": if armed_min_fix == 10 { 0 } else { armed_min_fix },
            "overall_min_fix_type": if overall_lowest_fix == 10 { 0 } else { overall_lowest_fix },
            "gps_glitches": gps_glitches,
        },
        "motors": {
            "saturation_count": motor_saturation_count,
            "hover_throttle_pct": estimated_hover_pct,
            "first_saturation_us": if first_motor_saturation_us > 0 { Some(first_motor_saturation_us) } else { None }
        },
        "flight": {
            "armed_detected": first_armed_us > 0,
            "first_armed_us": first_armed_us,
            "last_disarmed_us": last_disarmed_us,
            "armed_duration_s": ((armed_time_total_us as f64) / 100_000.0).round() / 10.0,
        },
        "modes": modes.into_iter().map(|(t, m)| json!({ "time_us": t, "mode": m })).collect::<Vec<_>>(),
        "recent_errors": errors,
        "recent_events": events,
        "verdict": {
            "safe_to_fly": is_safe,
            "health_score": health_score,
            "health_status": overall_health,
            "issues_count": issues.len(),
            "issues": issues
        }
    })
}

pub fn audit(id: &str) -> Value {
    let bytes = match read_id(id) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    audit_bytes(&bytes)
}
