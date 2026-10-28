// Tool descriptions.
// Say what the tool is for, what distinctive information it returns, and how to call it.
// Distinctive information is the result keys the model needs before the call, so it can choose this tool.
// A parameter description says what to write: the pattern, the unit, and where the value comes from.
// A field-by-field reading stays in the `note` on the result: what a number means, and what it is not. Do not point at that note from here.
// Do not repeat a rule the root skill already states. Which tool owns another kind of name, and how to treat a document or a web page, stay there.
// One fact per line.

macro_rules! doc {
    ($($line:literal),+ $(,)?) => {
        concat!($($line, "\n"),+)
    };
}

fn tool_schema() -> Value {
    json!([
        {
            "name": "vehicle_state",
            "description": doc!(
                "Whether the link is up, and the live flight picture: frame, mode, armed, attitude, and altitude.",
                "It also says whether the parameter set on the link is complete.",
                "It returns `controller_key` and `vehicle_comment`, the local note stored for this vehicle.",
                "It returns `sitl`, true when this link is a simulator.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "setup_status",
            "description": doc!(
                "The setup state of the linked vehicle as the Setup tab shows it: each step with its state and reason, and whether it can arm.",
                "The states come from the same rules as the Setup list, including PreArm lines matched to steps.",
                "Without `section` it returns one line per step. With a step id it returns that step with the parameters it reads and their values.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    // Step ids are defined in ArduLoops `src/components/HardwareSetup.tsx` (COPTER, PLANE). Keep both lists the same.
                    "section": {
                        "type": "string",
                        "enum": ["overview", "frame", "motors", "airframe", "servos", "level", "compass", "airspeed", "battery", "radio", "modes", "failsafe"],
                        "description": doc!(
                            "`overview`, or one step. Copter and plane: `level` (accelerometer), `compass`, `battery`, `radio`, `modes`, `failsafe`.",
                            "Copter only: `frame`, `motors` (motors and outputs). Plane only: `airframe` (airframe type), `servos` (outputs).",
                            "A step this vehicle does not have returns the ids it does have.",
                        ),
                    }
                }
            }
        },
        {
            "name": "get_param",
            "description": doc!(
                "The current value of parameter names whose spelling is already known.",
                "Pass `names`, at most 40, or one `name`.",
                "A shorter name or a guess is a different spelling.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "names": { "type": "array", "items": { "type": "string" }, "description": "Exact parameter names, at most 40." },
                    "name": { "type": "string", "description": "One exact name, if `names` is omitted." }
                }
            }
        },
        {
            "name": "list_params",
            "description": doc!(
                "Find parameter names on the vehicle now, when the spelling is not known yet.",
                "Pass `glob` or `prefix`.",
                "Uses the live link when those names are present, otherwise the last saved set.",
                "At most 2000 rows.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "prefix": { "type": "string", "description": doc!(
                        "The start of a parameter name, such as `ATC_RAT_`.",
                        "Case is ignored.",
                        "An empty prefix lists every name, up to 2000.",
                        "It is not used when `glob` is set.",
                    ) },
                    "glob": { "type": "string", "description": doc!(
                        "A parameter-name pattern.",
                        "`*` matches any text, so `ATC_*` starts with ATC_ and `*RAT*` contains RAT.",
                        "Case is ignored.",
                        "When this is set, `prefix` is not used.",
                    ) }
                }
            }
        },
        {
            "name": "recent_status",
            "description": doc!(
                "Latest `STATUSTEXT` lines from the vehicle, newest first.",
                "`limit` defaults to 10 and is at most 64.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "limit": { "type": "number", "description": doc!(
                    "How many lines.",
                    "Default 10, at most 64.",
                ) } }
            }
        },
        {
            "name": "list_logs",
            "description": doc!(
                "Downloaded DataFlash .bin files on this computer, newest first.",
                "An `id` from here is the `file` for the local log tools.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "log_inspect",
            "description": doc!(
                "The overview of a local DataFlash log: what was recorded, how long it spans, which modes were armed, and the logging quality.",
                "Pass `file` for one id, or `files` for up to 4 ids, in one call.",
                "`logging` is the write-buffer picture for the whole file.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "One id from `list_logs`." },
                    "files": { "type": "array", "items": { "type": "string" }, "description": "Up to 4 ids in this one call." }
                }
            }
        },
        {
            "name": "log_params",
            "description": doc!(
                "Parameter values as they were recorded in that flight, including a value that changed during the log.",
                "Pass `names`, the exact spellings, at most 40.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "names": { "type": "array", "items": { "type": "string" }, "description": "Exact parameter names, at most 40." }
                },
                "required": ["file", "names"]
            }
        },
        {
            "name": "log_schema",
            "description": doc!(
                "The columns of DataFlash messages in one local log, including the unit that log recorded.",
                "Pass `messages`, every name, in one call, at most 12.",
                "One message name is accepted when `messages` is omitted.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "message": { "type": "string", "description": "One DataFlash message name, such as `RATE`, if `messages` is omitted." },
                    "messages": { "type": "array", "items": { "type": "string" }, "description": doc!(
                        "Every message name in this one call.",
                        "At most 12.",
                    ) }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_query",
            "description": doc!(
                "The raw rows of a message, when a summary is not enough.",
                "Pass `queries`, a list of {`message`, `start_us`, `end_us`, `cursor`, `limit`}, in one call.",
                "`message` is required.",
                "At most 500 rows per message.",
                "No silent downsampling.",
                "When more rows remain, the next call continues from `next_cursor`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "message": { "type": "string", "description": "One DataFlash message name, such as `RATE`, if `queries` is omitted." },
                    "queries": {
                        "type": "array",
                        "description": doc!(
                            "Every message to read, in this one call.",
                            "At most 16.",
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "message": { "type": "string", "description": "A DataFlash message name from `log_schema`, such as `RATE`." },
                                "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                                "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." },
                                "cursor": { "type": "number", "description": "How many matching rows to skip. `0` is the first row. The next page uses `next_cursor`." },
                                "limit": { "type": "number", "description": "How many rows to return, at most 500. Defaults to 50." }
                            },
                            "required": ["message"]
                        }
                    },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds, if `queries` is omitted." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds, if `queries` is omitted." },
                    "cursor": { "type": "number", "description": "How many matching rows to skip, if `queries` is omitted. `0` is the first row." },
                    "limit": { "type": "number", "description": "How many rows to return, at most 500, if `queries` is omitted. Defaults to 50." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_compute",
            "description": doc!(
                "Numbers for series in one local log.",
                "`op` is `min`, `max`, `mean`, `rms`, `count`, `fft`, `track`, or `frf`.",
                "`min`, `max`, `mean`, `rms`, and `count` each return `value` for one column, and also `min`, `max`, `mean`, `rms`, and `count`.",
                "`fft` on one column returns `peak_hz`.",
                "`fft` on a gyro axis (`GyrX`, `GyrY`, `GyrZ`, or `x`, `y`, `z`) of `IMU`, `ISBH`, `ISBD`, or `GYR` also returns harmonics and a `spectrogram`.",
                "A `spectrogram` line can include `follows_throttle`.",
                "`track` measures how actual followed the command.",
                "`track` returns `error_rms`, `error_p95`, `corr`, `spread`, `lag_s`, `peak_error`, `past_command`, `release`, `active_error_rms`, `sample_hz`, `step`, `holds`, `hold_count`, `sides`, `error_peak_hz`, and `error_peak_share`.",
                "`step`, when one command held, returns `zeta`, `wn_hz`, and `fit_rms`.",
                "Rise time, percent overshoot, and settling time are not separate fields.",
                "`holds` lists each command that changed and then stayed, up to ten, in time order. `hold_count` is the full number.",
                "Each entry has `from`, `command`, `hold_s`, `overshoot`, and `reached`.",
                "`sides` returns `beyond` and `short`. Each has `count`, `share`, `mean`, and `p95`.",
                "On a message with Tar and Act, `track` also returns `p_rms`, `i_rms`, `d_rms`, `ff_rms`, and `p_share`, `i_share`, `d_share`, `ff_share`.",
                "`frf` returns a bin for each frequency with `gain_db`, `phase_deg`, and `coherence`, plus `bandwidth_hz` and `group_delay_s`.",
                "Pass `jobs`, a list of {`message`, `field`, `op`, `start_us`, `end_us`}, at most 16, all on `file`.",
                "`message`, `field`, and `op` are required.",
                "`start_us` and `end_us` bound that job.",
                "For `track` and `frf`, pass the actual column.",
                "The command is that name with Des before or after it, dem after it, or Tar when the actual column is Act.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "jobs": {
                        "type": "array",
                        "description": doc!(
                            "Every series in this one call.",
                            "At most 16.",
                            "Each item needs `message`, `field`, and `op`.",
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "message": { "type": "string", "description": "A DataFlash message name from `log_schema`, such as `RATE`." },
                                "field": { "type": "string", "description": "A column of that message. For `track` and `frf`, the actual column." },
                                "op": { "type": "string", "description": "`min`, `max`, `mean`, `rms`, `count`, `fft`, `track`, or `frf`." },
                                "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                                "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." }
                            },
                            "required": ["message", "field", "op"]
                        }
                    },
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "message": { "type": "string", "description": "One DataFlash message name, if `jobs` is omitted." },
                    "field": { "type": "string", "description": "A column of that message, if `jobs` is omitted. For `track` and `frf`, the actual column." },
                    "op": { "type": "string", "description": "`min`, `max`, `mean`, `rms`, `count`, `fft`, `track`, or `frf`, if `jobs` is omitted." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds, if `jobs` is omitted." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds, if `jobs` is omitted." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_magfit",
            "description": doc!(
                "Calculates compass calibration parameters from a DataFlash log using least-squares fit against the World Magnetic Model (equivalent to ArduPilot WebTools MAGFit).",
                "Returns `orig_error_mgauss`, `fit_error_mgauss`, `reduction_pct`, `coverage_pct`, `orientation` (logged, best_fit, matches), and `params` (offsets, diagonals, off-diagonals, scale, motor compensation, and orientation).",
                "`compass` is the compass index: 1 (default), 2, or 3.",
                "`fit_type` is `offsets`, `scale`, or `iron` (default).",
                "`motor_comp` is `none` (default), `throttle`, or `current`.",
                "`check_orientation` verifies mounting rotation against all 38 ArduPilot orientations. Defaults to true.",
                "`start_us` and `end_us` bound the analyzed flight interval.",
                "`lat` and `lon` are optional latitude and longitude (in degrees). Provide them if the log does not contain GPS or origin records (e.g. indoor flights or bench tests).",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "compass": { "type": "integer", "description": "Compass index (1, 2, or 3). Defaults to 1." },
                    "fit_type": { "type": "string", "enum": ["offsets", "scale", "iron"], "description": "Calibration model: `offsets`, `scale`, or `iron`. Defaults to `iron`." },
                    "motor_comp": { "type": "string", "enum": ["none", "throttle", "current"], "description": "Motor interference compensation: `none`, `throttle`, or `current`. Defaults to `none`." },
                    "check_orientation": { "type": "boolean", "description": "Whether to check mounting rotation against standard ArduPilot orientations. Defaults to true." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." },
                    "lat": { "type": "number", "description": "Flight location latitude in degrees. Optional; overrides or provides coordinates if GPS is missing from the log." },
                    "lon": { "type": "number", "description": "Flight location longitude in degrees. Optional; overrides or provides coordinates if GPS is missing from the log." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_filter_review",
            "description": doc!(
                "Analyzes gyro vibration noise and optimizes harmonic notch and low-pass filter parameters from a DataFlash log (equivalent to ArduPilot WebTools FilterReview).",
                "Simulates post-filter noise attenuation and control phase delay.",
                "Returns primary motor noise peak, estimated hover throttle, current vs proposed filter parameters, and noise reduction (dB).",
                "`axis` is `all` (default), `roll`, `pitch`, or `yaw`.",
                "`start_us` and `end_us` bound the analyzed flight interval.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "axis": { "type": "string", "enum": ["all", "roll", "pitch", "yaw"], "description": "Gyro axis to analyze. Defaults to `all`." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_audit",
            "description": doc!(
                "Performs a comprehensive flight safety, crash detection, and hardware health audit from a DataFlash log (equivalent to ArduPilot WebTools HardwareReport with FlightMD and ardupilot-mcp rule extensions).",
                "Evaluates a deterministic health score (0..100) across vibrations, clipping, 5V brownouts, battery sag, EKF innovations/lane switches, in-flight GPS quality, motor saturation, and safety parameters.",
                "Returns structured category verdicts (PASS/WARN/FAIL), prioritized issues with recommendations, and key timeline intervals for charting.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_motor_balance",
            "description": doc!(
                "Analyzes in-flight motor thrust balance, center of gravity (CG) offsets, and motor arm twist from a DataFlash log.",
                "Evaluates individual motor PWM outputs (RCOU) and ESC telemetry (RPM, current, temperature).",
                "Diagnoses forward/aft CG bias, lateral CG bias, CW vs CCW motor twist, and damaged or degraded motor/propeller outliers.",
                "`start_us` and `end_us` bound the analyzed flight interval.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "log_pid_review",
            "description": doc!(
                "Evaluates rate PID tuning quality, stability margins, and step responses from a DataFlash log (equivalent to ArduPilot WebTools PIDReview).",
                "Computes Phase Margin (PM), Gain Margin (GM), Rise Time, Peak Overshoot (%), and Settling Time.",
                "Recommends concrete P and D parameter changes to achieve optimal damping and phase margin.",
                "`axis` is `roll` (default), `pitch`, or `yaw`.",
                "`start_us` and `end_us` bound the analyzed flight interval.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "axis": { "type": "string", "enum": ["roll", "pitch", "yaw"], "description": "Rate axis to review: `roll` (default), `pitch`, or `yaw`." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." }
                },
                "required": ["file"]
            }
        },
        {
            "name": "suggest_next",
            "description": doc!(
                "Show buttons under the reply for what the user may do next.",
                "A button puts its full `prompt` into the message box. The user edits it or sends it; nothing is sent by the call.",
                "Pass `items`, at most 4 in all.",
                "`kind: ask` is a question the user may want to ask about what this reply found.",
                "`kind: offer` is a next step you recommend, such as a further measurement.",
                "A mix of both kinds usually serves the user best.",
                "The buttons replace such questions at the end of the reply text.",
                "For example, after a detailed analysis, an offer can be an interactive HTML report made with `save_document`, when that tool is in this conversation.",
                "A later call in the same turn replaces the buttons.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "The buttons, at most 4 in all.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind": { "type": "string", "enum": ["ask", "offer"], "description": "`ask` for a question the user may ask, `offer` for a next step you recommend." },
                                "label": { "type": "string", "description": "A few words on the button, in the reply language." },
                                "prompt": { "type": "string", "description": "The full request the button puts into the message box, in the reply language." }
                            },
                            "required": ["kind", "label", "prompt"]
                        }
                    }
                },
                "required": ["items"]
            }
        },
        {
            "name": "show_chart",
            "description": doc!(
                "Draw a chart under the reply for the user.",
                "Pass `title` and `axes`.",
                "Each axis has a `label` and `lines`.",
                "Each line names a `message` and a `field` in `file`.",
                "`name` is the label on that line.",
                "When `name` is omitted the line is `message.field`.",
                "`x` is TimeUS, in seconds.",
                "`start_us` and `end_us` bound every line.",
                "At most 2 axes and 8 lines.",
                "`slug` names the chart in this turn.",
                "A later call with the same `slug` replaces that chart.",
                "That call does not add a chart.",
                "`remove: true` with that slug removes the chart.",
                "`file` and `axes` are not used when `remove` is true.",
                "A chart without a `slug` cannot be replaced or removed.",
                "At most 5 charts are shown in one turn.",
                "Every finite sample in the interval is drawn.",
                "The result names each line, how many points were drawn, and the minimum and maximum of that line.",
                "It does not include the samples.",
                "A field that is not in the log is named and is not drawn.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`." },
                    "title": { "type": "string", "description": "The heading shown on the chart." },
                    "slug": { "type": "string", "description": "A short name for this chart in the turn. The same slug replaces it." },
                    "remove": { "type": "boolean", "description": "Remove the chart with this `slug`. `file` and `axes` are not used." },
                    "start_us": { "type": "number", "description": "TimeUS lower bound, in microseconds. Omit it for no lower bound." },
                    "end_us": { "type": "number", "description": "TimeUS upper bound, in microseconds. Omit it for no upper bound." },
                    "axes": {
                        "type": "array",
                        "description": "At most 2. Each axis has a `label` and `lines`.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": { "type": "string", "description": "The axis caption." },
                                "lines": {
                                    "type": "array",
                                    "description": "At most 8 lines on this axis.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "message": { "type": "string", "description": "A DataFlash message name in `file`." },
                                            "field": { "type": "string", "description": "A column of that message." },
                                            "name": { "type": "string", "description": "The legend label. Omit it to use `message.field`." }
                                        },
                                        "required": ["message", "field"]
                                    }
                                }
                            },
                            "required": ["lines"]
                        }
                    }
                },
                "required": []
            }
        },
        {
            "name": "show_spectrum",
            "description": doc!(
                "Draw the gyro spectrum under the reply.",
                "`x` is Hz across the FFT bins.",
                "`X`, `Y`, and `Z` are dB on each gyro axis against the loudest raw bin.",
                "`X filtered`, `Y filtered`, and `Z filtered` are that scale on the filtered capture, and only when the log has one.",
                "`notch` is the configured harmonic notch, and `notch 2` the second, drawn only when that filter is enabled in the log.",
                "Slug, remove, and the five-chart limit work as on `show_chart`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`. Omit it for the log already selected." },
                    "title": { "type": "string", "description": "The heading shown on the chart. Omit it for `spectrum`." },
                    "slug": { "type": "string", "description": "A short name for this chart in the turn. The same slug replaces it." },
                    "remove": { "type": "boolean", "description": "Remove the chart with this `slug`. `file` is not used." }
                }
            }
        },
        {
            "name": "show_spectrogram",
            "description": doc!(
                "Draw the gyro spectrogram under the reply.",
                "The map is time against frequency.",
                "Color is dB against the loudest cell of the raw pre-filter capture.",
                "`notch` is the notch frequency the log recorded, drawn on that map, and only when that column is present.",
                "Slug, remove, and the five-chart limit work as on `show_chart`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "An id from `list_logs`, or `local.id` from `vehicle_logs`. Omit it for the log already selected." },
                    "title": { "type": "string", "description": "The heading shown on the chart. Omit it for `spectrogram`." },
                    "slug": { "type": "string", "description": "A short name for this chart in the turn. The same slug replaces it." },
                    "remove": { "type": "boolean", "description": "Remove the chart with this `slug`. `file` is not used." }
                }
            }
        },
        {
            "name": "show_live",
            "description": doc!(
                "Show the live lines in one window under the reply.",
                "`charts` is the whole view.",
                "At most 5 charts.",
                "Each chart has a `title` and `lines`.",
                "At most 8 lines on one chart.",
                "A line is a MAVLink field name from `live_fields`, `MESSAGE.field`, or an exact parameter name from `list_params`.",
                "This call is the whole view.",
                "A later call replaces this view.",
                "It does not add a chart.",
                "The window draws the lines from the live link.",
                "The result names each line that will be drawn.",
                "It does not include samples.",
                "A line that is not a live field and not a parameter on this vehicle is named and is not drawn.",
                "A `gcs:send_named_float` name is `NAMED_VALUE_FLOAT.NAME` from `live_fields`.",
                "A `gcs:send_named_int` name is `NAMED_VALUE_INT.NAME` from `live_fields`.",
                "Do not plot `NAMED_VALUE_FLOAT.value` or `NAMED_VALUE_INT.value`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "charts": {
                        "type": "array",
                        "description": doc!(
                            "The charts in the one live window, at most 5.",
                            "A later `show_live` call replaces this array.",
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string", "description": "The chart heading. Omit it and the line names are used." },
                                "lines": {
                                    "type": "array",
                                    "description": "MAVLink field names from `live_fields`, or exact parameter names, at most 8.",
                                    "items": { "type": "string" }
                                }
                            },
                            "required": ["lines"]
                        }
                    }
                },
                "required": ["charts"]
            }
        },
        {
            "name": "live_fields",
            "description": doc!(
                "Which live `MESSAGE.field` names have arrived on the link.",
                "`fields` is an object. The key is the id for `live_buffer` and `show_live`.",
                "A field that has not arrived is not listed.",
                "A `gcs:send_named_float` name arrives as `NAMED_VALUE_FLOAT.NAME`.",
                "A `gcs:send_named_int` name arrives as `NAMED_VALUE_INT.NAME`.",
                "`NAMED_VALUE_FLOAT.value` and `NAMED_VALUE_INT.value` are not script names.",
            ),
            "parameters": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "live_buffer",
            "description": doc!(
                "Recent numbers for live fields: the latest value, the range, and a short trace.",
                "The buffer keeps about the last 60 seconds.",
                "`lines` are MAVLink field names from `live_fields`, `MESSAGE.field`, at most 8.",
                "`line` is one id when `lines` is omitted.",
                "`seconds` is the window, from 1 to 60, and defaults to 8.",
                "Each line has `n`, `latest`, `min`, `max`, `mean`, `unit`, and a short `points` list.",
                "It does not return every sample.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "lines": {
                        "type": "array",
                        "description": "MAVLink field names from `live_fields`, `MESSAGE.field`, at most 8.",
                        "items": { "type": "string" }
                    },
                    "line": { "type": "string", "description": "One live field id, if `lines` is omitted." },
                    "seconds": { "type": "number", "description": "Window length, from 1 to 60. Defaults to 8." }
                },
                "required": []
            }
        },
        {
            "name": "param_doc",
            "description": doc!(
                "The official description, range, and units for exact parameter names.",
                "Pass `names`: one exact name, or a list of them, at most 40.",
                "The result is text.",
                "Each name is its own metadata section, after one metadata section with `count`.",
                "`content` is that parameter's documentation when the metadata has it.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "names": {
                        "description": doc!(
                            "One exact parameter name, or a list of them.",
                            "At most 40.",
                            "One call for every name.",
                        ),
                        "anyOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    }
                },
                "required": ["names"]
            }
        },
        {
            "name": "ardupilot_doc",
            "description": doc!(
                "Search the official vehicle docs.",
                "The first result starts at the paragraph that mentions the `query` and is at most 1400 characters.",
                "`offset` continues that same page: pass `next_offset` from the previous result with the same `query`.",
                "`query` is a few words.",
                "The result is text.",
                "`metadata` names the page, `offset`, and `next_offset`.",
                "`content` is the page text.",
                "An error or an unmatched query is metadata only.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "A few words, such as a flight-mode name. Not a URL and not a file path." },
                    "offset": { "type": "number", "description": doc!(
                        "Character index into this page.",
                        "Omit it to start at the matching paragraph.",
                        "0 is the beginning.",
                        "`next_offset` continues.",
                    ) }
                },
                "required": ["query"]
            }
        },
        {
            "name": "web_search",
            "description": doc!(
                "Search the public web.",
                "Returns titles and URLs.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "query": { "type": "string", "description": "The words to search for." } },
                "required": ["query"]
            }
        },
        {
            "name": "web_fetch",
            "description": doc!(
                "Read one public http or https page as Markdown.",
                "Jina Reader returns the article, without the site menu.",
                "Local and private addresses are refused.",
                "The result is text.",
                "`metadata` names the url.",
                "`content` is the article, at most 8000 characters.",
                "An error is metadata only.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "url": { "type": "string", "description": "One public http or https address." } },
                "required": ["url"]
            }
        },
        {
            "name": "firmware_source_read",
            "description": doc!(
                "Read a line range from a pinned stable tag.",
                "Pass `path`, or `paths` for several files, or one `glob` of a single directory such as `libraries/AP_Motors/*.cpp`.",
                "One call reads at most 8 files.",
                "`path` is a repository path a previous tool result already named, or a file this glob just listed, starting with `ArduCopter/`, `ArduPlane/`, `Rover/`, or `libraries/`.",
                "A guessed filename is not in the tree.",
                "`start_line` and `end_line` are inclusive.",
                "When `end_line` is omitted the slice is 500 lines.",
                "One call returns at most 500 lines.",
                "The result is text.",
                "`metadata` names the file, the tag, the line range, `next_line`, and `line_count`.",
                "`content` is the file text.",
                "An error is metadata only.",
                "Several files are several of those sections after one metadata section with `count` and `remaining`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "One repository path a previous result already named, starting with `ArduCopter/`, `ArduPlane/`, `Rover/`, or `libraries/`." },
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "Several of those paths. One call reads at most 8 files." },
                    "glob": { "type": "string", "description": "One directory pattern, such as `libraries/AP_Motors/*.cpp`." },
                    "start_line": { "type": "number", "description": "First line, inclusive. Defaults to 1." },
                    "end_line": { "type": "number", "description": "Last line, inclusive. Omit it for 500 lines. One call returns at most 500." }
                }
            }
        },
        {
            "name": "firmware_catalog",
            "description": doc!(
                "Read the official custom.ardupilot.org catalog.",
                "`resource` is `vehicles`, `versions`, `boards`, `features`, or `standard_artifacts`.",
                "No device changes.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "resource": { "type": "string", "description": "`vehicles`, `versions`, `boards`, `features`, or `standard_artifacts`." },
                    "vehicle_id": { "type": "string", "description": "An id from `vehicles`, such as `copter`. Required except for `vehicles`." },
                    "version_id": { "type": "string", "description": "An id from `versions`. Required for `boards`, `features`, and `standard_artifacts`." },
                    "board_id": { "type": "string", "description": "A board name from `boards`, such as `JHEM_JHEF405`. Required for `features` and `standard_artifacts`." }
                },
                "required": ["resource"]
            }
        },
        {
            "name": "firmware_build",
            "description": doc!(
                "Custom firmware on the official build service.",
                "`action` is `plan`, `submit`, `status`, `logs`, or `download`.",
                "`plan` starts from catalog defaults, or from `features` when that selected list is passed, then applies `enable` and `disable`.",
                "`submit` queues that plan and waits until the build finishes.",
                "`status` waits the same way.",
                "The result is the finished state.",
                "`logs` reads the text after that.",
                "`download` saves a validated APJ and does not flash.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "description": "`plan`, `submit`, `status`, `logs`, or `download`." },
                    "vehicle_id": { "type": "string", "description": "An id from `firmware_catalog` `vehicles`, such as `copter`. Required for `plan`." },
                    "version_id": { "type": "string", "description": "An id from `firmware_catalog` `versions`. Required for `plan`." },
                    "board_id": { "type": "string", "description": "A board name from `firmware_catalog` `boards`. Required for `plan`." },
                    "features": { "type": "array", "items": { "type": "string" }, "description": "Feature ids that replace the catalog defaults. Omit it to start from those defaults." },
                    "enable": { "type": "array", "items": { "type": "string" }, "description": "Feature ids to add." },
                    "disable": { "type": "array", "items": { "type": "string" }, "description": "Feature ids to remove." },
                    "plan_id": { "type": "string", "description": "The `plan_id` from `plan`. Required for `submit`." },
                    "build_id": { "type": "string", "description": "The `build_id` from `submit`. Required for `status`, `logs`, and `download`." },
                    "tail": { "type": "number", "description": "How many build-log lines to return, from 1 to 1000. Defaults to 100." }
                },
                "required": ["action"]
            }
        },
        {
            "name": "firmware_library",
            "description": doc!(
                "Local downloaded firmware images and compatibility with the connected controller.",
                "`running` is the image this app last wrote to the connected controller, and only while the firmware hash on the controller still matches that image.",
                "`running.features` is that image's customization list.",
                "The controller does not report features.",
                "`controller.comment` is the local note typed for this controller.",
                "A hash by itself is the source commit.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "vehicle_comment",
            "description": doc!(
                "Replace the local note on this vehicle.",
                "Pass `controller_key` from `vehicle_state` and `comment`, the whole note.",
                "It does not append.",
                "This always stops the turn, including while safe mode is on.",
                "Nothing is stored until the user saves the card.",
                "The user can edit the note on that card before it is stored.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "controller_key": { "type": "string", "description": "The `controller_key` from `vehicle_state`." },
                    "comment": { "type": "string", "description": "The whole note the card starts with. At most 2000 characters." }
                },
                "required": ["controller_key", "comment"]
            }
        },
        {
            "name": "firmware_flash",
            "description": doc!(
                "USB flash of a downloaded artifact.",
                "`action` is `ports`, `prepare`, `start_bootloader`, or `status`.",
                "`prepare`, `ports`, and `status` always run.",
                "`start_bootloader` writes the image only when `confirmation` is the exact phrase from `prepare`, the vehicle is linked, and it is disarmed.",
                "While safe mode is off, `start_bootloader` is stored as a card, this turn stops, and nothing is sent until the user approves it.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "description": "`ports`, `prepare`, `start_bootloader`, or `status`." },
                    "artifact_id": { "type": "string", "description": "An image id from `firmware_library`." },
                    "port": { "type": "string", "description": "A USB port name from `ports`, such as `COM11`." },
                    "plan_id": { "type": "string", "description": "The `plan_id` from `prepare`. Required for `start_bootloader`." },
                    "confirmation": { "type": "string", "description": "The exact `confirmation` phrase returned by `prepare`." }
                },
                "required": ["action"]
            }
        },
        {
            "name": "vehicle_logs",
            "description": doc!(
                "Logs still stored on the vehicle, and which of them already has a local copy of the same size.",
                "Each row has `id`, `size`, and `time_utc`.",
                "This list does not download bytes.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "refresh": { "type": "boolean", "description": "When true, ask the vehicle again. Defaults to true." } }
            }
        },
        {
            "name": "download_vehicle_log",
            "description": doc!(
                "Download one on-board DataFlash log into local storage and return its `file` id.",
                "Requires a fresh disarmed heartbeat.",
                "When a local file already has this onboard id and this exact size, the result is that file and nothing is transferred.",
                "`force_download` transfers the bytes again even then.",
                "Set `force_download` only when the user asked to download this recording again.",
                "A request to fetch the newest log still uses the local file when one is already stored.",
                "Otherwise the call waits until the transfer ends, the link times out, or the user cancels.",
                "Progress is on screen.",
                "Do not tell the user to start the download again.",
                "The returned `file` is the id for the local log tools.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "log_id": { "type": "number", "description": "The onboard log number from `vehicle_logs`, the row `id`. This is not a local file id." },
                    "force_download": { "type": "boolean", "description": doc!(
                        "Transfer again even when a local file of this size exists.",
                        "Set only when the user asked to download this recording again.",
                    ) },
                    "timeout_s": { "type": "number", "description": "How many seconds to wait, from 5 to 3600. Omit it and the wait follows the file size." }
                },
                "required": ["log_id"]
            }
        },
        {
            "name": "erase_vehicle_logs",
            "description": doc!(
                "Permanently erase every on-board DataFlash log.",
                "This clears the log chip only and does not change parameters.",
                "Requires `confirm: true`, a linked vehicle, and a fresh disarmed heartbeat.",
                "While safe mode is off, this stores a card, this turn stops, and nothing is erased until the user approves it.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "confirm": { "type": "boolean", "description": "Must be `true`. Nothing is erased otherwise." } },
                "required": ["confirm"]
            }
        },
        {
            "name": "diagnostics",
            "description": doc!(
                "Firmware identity, sensor health, flow, `STATUSTEXT`, command ACKs, and parameter download completeness.",
                "`params.missing` is how many parameter slots have not arrived. It is not a list of names.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "refresh": { "type": "boolean", "description": "When true, request a fresh sample before reading. Defaults to false." } }
            }
        },
        {
            "name": "connect",
            "description": doc!(
                "Point the link at the vehicle.",
                "Pass `kind` `tcp`, `udp`, or `serial`, plus `host`, `port`, and `baud`.",
                "`tcp` uses `tcpout:host:port` (default `127.0.0.1:5760`).",
                "`udp` with no host listens (`udpin`, default port 14550); `udp` with a host sends (`udpout:host:port`).",
                "`serial` uses the port name in `host`, such as `COM11`, and `baud` (default 115200).",
                "A full `url` is accepted instead.",
                "If this url is already the live link, the result is `applied` with `already_linked: true` and the link was not opened again.",
                "The result is `applied`, `rejected_by_user`, or `failed`, and includes `linked`, `detail`, `frame`, `mode`, and `armed`.",
                "While safe mode is off, a card stops the turn only when the link is not already up.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "description": "`tcp`, `udp`, or `serial`." },
                    "host": { "type": "string", "description": doc!(
                        "TCP or UDP host.",
                        "For `serial`, the port name such as `COM11`.",
                    ) },
                    "port": { "type": "number", "description": "TCP or UDP port. `tcp` defaults to 5760. `udp` with no host defaults to 14550." },
                    "baud": { "type": "number", "description": "Serial speed. Defaults to 115200." },
                    "url": { "type": "string", "description": "Full MAVLink URL, if `kind` is omitted." }
                }
            }
        },
        {
            "name": "set_mode",
            "description": doc!(
                "Set the flight mode by name.",
                "Runs immediately only while safe mode is on.",
                "Otherwise it stores a card, this turn stops, and the mode does not change.",
            ),
            "parameters": {
                "type": "object",
                "properties": { "mode": { "type": "string", "description": "A flight-mode name the vehicle uses, such as `LOITER` or `ALT_HOLD`." } },
                "required": ["mode"]
            }
        },
        {
            "name": "set_param",
            "description": doc!(
                "Write one or more parameters.",
                "Pass `changes` as a list of {`name`, `value`, `reason`}, or one `name`, `value`, and `reason`.",
                "`failed` with `Disconnected` means nothing was written.",
                "A write that would erase parameter storage or the internal flash is refused and nothing is sent.",
                "While safe mode is on, the write is sent.",
                "While safe mode is off, the turn stops until the user decides.",
                "The result is `applied`, `rejected_by_user`, or `failed` with `error`.",
                "`applied` includes `results` when a readback exists.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "changes": {
                        "type": "array",
                        "description": "Each write in this call, at most 16. Each item needs `name`, `value`, and `reason`.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "description": "The exact parameter name." },
                                "value": { "type": "number", "description": "The number to write." },
                                "reason": { "type": "string", "description": "Why this value is written, in a short phrase." }
                            },
                            "required": ["name", "value", "reason"]
                        }
                    },
                    "name": { "type": "string", "description": "One exact parameter name, if `changes` is omitted." },
                    "value": { "type": "number", "description": "The number to write, if `changes` is omitted." },
                    "reason": { "type": "string", "description": "Why this value is written. Required." }
                }
            }
        },
        {
            "name": "arm",
            "description": doc!(
                "Arm the vehicle.",
                "Runs immediately while safe mode is on or in SITL, verifying actual arming with the autopilot.",
                "NOTE: On ArduPilot Copter, arming on the ground requires zero throttle. Call `rc_stick(preset: \"zero_throttle\")` before `arm` to prevent PreArm throttle rejection.",
                "Returns `armed: true` when confirmed by the autopilot, or `armed: false` with `status_text` containing pre-arm failure reasons.",
                "While safe mode is off, stores an approval card and waits for user confirmation.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "disarm",
            "description": doc!(
                "Disarm the vehicle.",
                "Runs immediately while safe mode is on or in SITL, verifying actual disarming with the autopilot.",
                "Returns `armed: false` when confirmed by the autopilot.",
                "While safe mode is off, stores an approval card and waits for user confirmation.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "mav_command",
            "description": doc!(
                "Sends one or more MAVLink commands (COMMAND_LONG) to the connected vehicle.",
                "Pass an array of one or more commands in `commands`.",
                "Supported commands: `NAV_TAKEOFF` (takeoff with `alt_m`), `NAV_LAND`, `NAV_RETURN_TO_LAUNCH`, `DO_REPOSITION`, `DO_SET_SERVO` (`servo`, `pwm`), `DO_CHANGE_SPEED` (`speed_mps`), `DO_VTOL_TRANSITION`, or numeric command IDs.",
                "Timing: Commands in `commands` execute immediately in sequence without pauses.",
                "If time is needed between actions (such as climbing to altitude after takeoff or settling), use the `wait` tool between commands.",
                "While safe mode is off, an approval card stops the turn until the user approves it.",
                "While safe mode is on or in SITL, commands run immediately and are recorded as applied cards.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "commands": {
                        "type": "array",
                        "description": "List of MAVLink commands to execute in sequence. Each item specifies `command`, optional `params`, and optional `reason`.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "command": {
                                    "type": "string",
                                    "description": "MAVLink command name or numeric ID (e.g. `NAV_TAKEOFF`, `NAV_LAND`, `NAV_RETURN_TO_LAUNCH`, `DO_REPOSITION`, `DO_SET_SERVO`, `DO_CHANGE_SPEED`, `DO_VTOL_TRANSITION`)."
                                },
                                "params": {
                                    "type": "object",
                                    "description": "Parameters for the command: `alt_m` (for takeoff/reposition), `speed_mps` (for speed/reposition), `servo` & `pwm` (for DO_SET_SERVO), `lat` & `lon` (for reposition), or raw `param1`..`param7`."
                                },
                                "reason": {
                                    "type": "string",
                                    "description": "Engineering rationale for why this command is being sent."
                                }
                            },
                            "required": ["command"]
                        }
                    }
                },
                "required": ["commands"]
            }
        },
        {
            "name": "wait",
            "description": doc!(
                "Pause execution for a specified duration in seconds or until an altitude or flight mode condition is met.",
                "Displays a live waiting proposal card in chat showing what is being waited for, which completes when the condition is met.",
                "Use this tool to introduce necessary delays between sequential commands (such as waiting for climb after takeoff, spool-up time, or mode settling).",
                "Returns fresh vehicle state (`alt_m`, `mode`, `armed`, `groundspeed_mps`, `climb_mps`, `status_text`) upon completion.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "seconds": {
                        "type": "number",
                        "description": "Duration to wait in seconds (1.0 to 60.0). Defaults to 5.0."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Engineering reason for the pause (e.g. 'Wait for altitude climb to 100m')."
                    },
                    "target_alt_m": {
                        "type": "number",
                        "description": "Optional target altitude in meters. If set, wait finishes early when vehicle reaches or crosses this altitude."
                    },
                    "target_mode": {
                        "type": "string",
                        "description": "Optional target flight mode (e.g. 'LOITER', 'AUTO'). If set, wait finishes early when mode matches."
                    }
                },
                "required": ["seconds"]
            }
        },
        {
            "name": "rc_stick",
            "description": doc!(
                "Controls virtual pilot RC sticks (Roll, Pitch, Throttle, Yaw) sent via MAVLink RC override.",
                "In Copter modes where altitude is controlled by pilot throttle (such as LOITER, ALT_HOLD, and POSHOLD), neutral throttle (1500 PWM) holds altitude. Throttle below 1500 commands descent, and above 1500 commands climb.",
                "Use `preset: \"neutral\"` or `throttle: 1500` to maintain altitude in LOITER/ALT_HOLD.",
                "Use `preset: \"zero_throttle\"` or `throttle: 1000` to command zero throttle on the ground.",
                "Use `preset: \"release\"` to clear stick override and return control to physical RC.",
                "While safe mode is off, an approval card stops the turn until the user approves it.",
                "While safe mode is on or in SITL, stick changes run immediately and are recorded as applied cards.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": ["neutral", "zero_throttle", "release"],
                        "description": "Convenient stick preset: `neutral` (all sticks at 1500 to hold altitude), `zero_throttle` (throttle 1000, others 1500), or `release` (clear override)."
                    },
                    "throttle": {
                        "type": "number",
                        "description": "Throttle PWM (1000 to 2000). 1500 is neutral/hold altitude, 1000 is zero/down, 2000 is full climb."
                    },
                    "roll": {
                        "type": "number",
                        "description": "Roll PWM (1000 to 2000). 1500 is centered neutral."
                    },
                    "pitch": {
                        "type": "number",
                        "description": "Pitch PWM (1000 to 2000). 1500 is centered neutral."
                    },
                    "yaw": {
                        "type": "number",
                        "description": "Yaw PWM (1000 to 2000). 1500 is centered neutral."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Engineering rationale for this stick command (e.g. 'Set throttle to neutral 1500 to hold altitude in LOITER')."
                    }
                }
            }
        },
        {
            "name": "reboot",
            "description": doc!(
                "Reboot the flight controller.",
                "This drops the link and does not enter the firmware bootloader.",
                "The turn waits until the link drops and a fresh heartbeat returns.",
                "The result is `applied`, `rejected_by_user`, or `failed`.",
                "While safe mode is off, a card stops the turn before the reboot is sent.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "disconnect",
            "description": doc!(
                "Drop the MAVLink link without rebooting the vehicle.",
                "The turn waits until the link is down.",
                "The result is `applied`, `rejected_by_user`, or `failed`.",
                "While safe mode is off, a card stops the turn before the link is dropped.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "wizard_widget",
            "description": doc!(
                "Show a button that opens one setup wizard.",
                "Each name is for a copter, a plane, or both. The call fails when the heartbeat is missing or is the other vehicle.",
                "Copter and plane: `accel` (six-face accelerometer), `compass` (offsets and diagonals), `radio` (live channels, stick ends, and channel reverse), `modes` (flight-mode switch channel and the six positions; the list follows the heartbeat), `battery` (monitor, capacity, voltage match, and current zero), `failsafe` (radio-loss and low-battery actions; the parameters follow the heartbeat).",
                "Copter only: `compass_mot` (motor-current compensation), `motors` (which output drives which motor, spin direction, and idle; any matrix frame or Tri).",
                "For `motors`, `steps` limits the run to some of `order`, `direction`, and `idle`, and `motors` limits order and direction to those motor numbers. Without them the whole setup runs. The window always starts with a safety check, ends with a summary, and adds `order` when a listed motor has no output.",
                "Plane only: `servos` (four surfaces, reverse, and free outputs), `airspeed` (no sensor, or leave the sensor that is already set).",
                "`radio` does not change the receiver port, the flight-mode switch, or the failsafe. `modes` and `battery` do not change the failsafe.",
                "Pass `title` and `description` in the user's language. The card shows the title, then why this run is needed.",
                "The turn stops until the user finishes that wizard or cancels the card. Safe mode does not skip this and does not start the wizard.",
                "The button only opens the window. The user presses every step inside it, including any step that spins a motor.",
                "`completed` means they reached the end. `result.measures` holds the values that screen can read, such as offsets, fitness, idle, compensation, or the six flight modes. For `motors` it lists the steps that ran, the outputs (`output:motor`), each direction answer, motors still waiting for a wire swap, and whether the board rebooted.",
                "`cancelled` means they closed the window or rejected the card before the end. Measures may still show the current values.",
                "`failed` means the procedure ended in failure, the heartbeat is the wrong vehicle, or this frame has no motor wizard.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "wizard": {
                        "type": "string",
                        "enum": ["accel", "compass", "compass_mot", "motors", "radio", "modes", "battery", "failsafe", "servos", "airspeed"],
                        "description": "Which wizard window to open. Copter and plane: `accel`, `compass`, `radio`, `modes`, `battery`, `failsafe`. Copter only: `compass_mot`, `motors`. Plane only: `servos`, `airspeed`."
                    },
                    "title": {
                        "type": "string",
                        "description": "A few words on the card, in the user's language. Name this run, such as `Калібрування компаса`."
                    },
                    "description": {
                        "type": "string",
                        "description": "One or two sentences on the card, in the user's language: what the user will do in the window and why."
                    },
                    "steps": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["order", "direction", "idle"] },
                        "description": "`motors` only. The steps to run. Omit for the whole setup."
                    },
                    "motors": {
                        "type": "array",
                        "items": { "type": "integer", "minimum": 1, "maximum": 12 },
                        "description": "`motors` only. Motor numbers for the order and direction steps. Omit for every motor."
                    }
                },
                "required": ["wizard", "title", "description"]
            }
        },
        {
            "name": "script_list",
            "description": doc!(
                "Lua scripts on the connected vehicle, and whether scripting is compiled in and turned on.",
                "`compiled` is whether `SCR_ENABLE` exists. `enabled` is whether that parameter is not 0.",
                "`files` lists `name` and `bytes` for each `.lua` file in the scripts directory.",
                "A module used by `require` is not in this list.",
                "`heap` is `SCR_HEAP_SIZE` when the vehicle has sent it.",
            ),
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "name": "script_read",
            "description": doc!(
                "The text of one Lua script on the vehicle.",
                "Pass `name`, the file name from `script_list`, such as `hello.lua`.",
                "The result is `name`, `body`, and `bytes`.",
                "If a user message already includes a Lua editor quote for that file, use the quote. Do not call this tool for it.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "A file name from `script_list`, such as `hello.lua`." }
                },
                "required": ["name"]
            }
        },
        {
            "name": "script_write",
            "description": doc!(
                "Create a Lua script or replace one that already exists.",
                "Pass `name`, ending in `.lua`, the full `body`, and `reason`.",
                "Nothing is written until the user approves the card in the chat. Safe mode does not skip the card.",
                "The result is `hold` until that decision, then `applied`, `rejected_by_user`, or `failed`.",
                "The vehicle keeps running the previous copy until `script_restart`.",
                "Every string the script prints is English ASCII, including `gcs:send_text` and logger text.",
                "The status log has no Cyrillic glyphs, so another language is drawn as broken characters.",
                "Only comments may be in the user's language. Identifiers and string literals stay English ASCII.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "File name ending in `.lua`, such as `hello.lua`. Letters, digits, `_`, `-`, and `.` only." },
                    "body": { "type": "string", "description": "The full Lua source to store, at most 96 KB. Printed strings are English ASCII. Only comments may be in the user's language." },
                    "reason": { "type": "string", "description": "Why this file is written, in a short phrase the user can read on the card." }
                },
                "required": ["name", "body", "reason"]
            }
        },
        {
            "name": "script_delete",
            "description": doc!(
                "Delete one Lua script from the vehicle.",
                "Pass `name` from `script_list`, and `reason`.",
                "Nothing is deleted until the user approves the card in the chat. Safe mode does not skip the card.",
                "The result is `hold` until that decision, then `applied`, `rejected_by_user`, or `failed`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "A file name from `script_list`, such as `hello.lua`." },
                    "reason": { "type": "string", "description": "Why this file is deleted, in a short phrase the user can read on the card." }
                },
                "required": ["name", "reason"]
            }
        },
        {
            "name": "script_restart",
            "description": doc!(
                "Reload Lua on the vehicle so it reads the scripts directory again.",
                "Pass `reason`.",
                "Nothing is sent until the user approves the card in the chat. Safe mode does not skip the card.",
                "The first time `SCR_ENABLE` is turned on, reload is not enough: the engine starts at the next boot.",
                "The result is `hold` until that decision, then `applied`, `rejected_by_user`, or `failed`.",
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": { "type": "string", "description": "Why scripting should reload, in a short phrase the user can read on the card." }
                },
                "required": ["reason"]
            }
        },
        {
            "name": "health",
            "description": doc!(
                "Whether the ArduLoops link process is serving.",
            ),
            "parameters": { "type": "object", "properties": {} }
        }
    ])
}
