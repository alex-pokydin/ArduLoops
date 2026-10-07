// Tests.


#[cfg(test)]
mod link_wait_tests {
        use super::{admit_chart, append_steer, attached_log_note, batch_token, begin_live, call_again, call_provider, change_detail, chat_tools, claim_steers_through, compact_prompt, connect_already_up, conversation_prompt, default_model, drain_steers, end_live, failure_body, fit_result, halt_turn, link_fresh, live_buffer, live_fields, live_reply, live_status, live_thinking, live_thought, load_secrets, log_download_wait_s, next_fold_turn, note_stopped_turns_on, note_tool, outcome_item, plan_context, provider_failure, provider_model, provider_turn, reasoning_effort, render_context, scrub_chart, show_live, stamp_live, tool_schema, tool_text, turn_halted, turn_is_live, turn_options, ui_notes, wizard_line, wizard_name_ok, xml_block, ChartBook, ChartSlot, MsgRow, SKILL_ROOT};
    use crate::link::Sample;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn spread_stays_a_ratio_in_the_tool_description() {
        let tools = tool_schema();
        let list = tools.as_array().expect("schema");
        let desc = list.iter()
            .find(|tool| tool["name"] == "log_compute")
            .and_then(|tool| tool["description"].as_str())
            .expect("log_compute");
        assert!(desc.contains("how actual followed the command"));
        assert!(desc.contains("`step`, when one command held, returns `zeta`, `wn_hz`, and `fit_rms`."));
        assert!(desc.contains("`spectrogram`"));
        assert!(desc.contains("`coherence`"));
        assert!(desc.contains("`error_peak_share`"));
        assert!(desc.contains("`follows_throttle`"));
        assert!(desc.contains("`error_rms`"));
        assert!(desc.contains("Rise time, percent overshoot, and settling time are not separate fields."));
        assert!(desc.contains("`holds` lists each command that changed and then stayed"));
        assert!(desc.contains("`sides` returns `beyond` and `short`."));
        assert!(!desc.contains("An `error_peak_share` near 1 is one tone in the error."));
        assert!(!desc.contains("`coherence` is actual against the command"));
        assert!(!desc.contains("`error_rms` is the tracking reading."));
        assert!(!desc.contains("not a ranking of loops"));
        assert!(!desc.contains("not a delay of the controller"));
        assert!(!desc.contains("A null `mean` means that side had no samples."));
        assert!(!desc.contains("A null `sides` means those samples were not there"));
        assert!(!desc.contains("The entries are not an average."));
        assert!(SKILL_ROOT.contains("not a ranking of loops"));
        assert!(SKILL_ROOT.contains("It does not say the controller delayed by that time."));
        assert!(SKILL_ROOT.contains("The entries are not an average."));
        assert!(SKILL_ROOT.contains("A null `mean` means that side had no samples."));
        assert!(!desc.contains("The result note reads"), "{desc}");
        assert!(!desc.contains("The sentence reports that ratio. It is not a percent."), "{desc}");
        assert!(!desc.contains("not a frequency, not an overshoot, not damping, and not a gain."));
        assert!(!desc.contains("percent past the command"), "{desc}");
        assert!(!desc.contains("varied more than the command"), "{desc}");
    }

    #[test]
    fn logging_names_rejected_writes_without_a_cause() {
        let tools = tool_schema();
        let list = tools.as_array().expect("schema");
        let desc = list.iter()
            .find(|tool| tool["name"] == "log_inspect")
            .and_then(|tool| tool["description"].as_str())
            .expect("log_inspect");
        assert!(desc.contains("logging quality"));
        fn arguments_say_what_to_write(path: &str, value: &serde_json::Value) {
            let Some(props) = value.get("properties").and_then(|item| item.as_object()) else { return };
            for (key, spec) in props {
                let text = spec.get("description").and_then(|item| item.as_str()).unwrap_or("");
                assert!(!text.trim().is_empty(), "{path}.{key} does not say what to write");
                arguments_say_what_to_write(&format!("{path}.{key}"), spec);
                if let Some(items) = spec.get("items") {
                    arguments_say_what_to_write(&format!("{path}.{key}[]"), items);
                }
            }
        }
        for tool in list {
            arguments_say_what_to_write(tool["name"].as_str().unwrap_or("tool"), &tool["parameters"]);
        }
        let listed = list.iter().find(|tool| tool["name"] == "list_params").unwrap();
        let prefix = listed["parameters"]["properties"]["prefix"]["description"].as_str().unwrap();
        let glob = listed["parameters"]["properties"]["glob"]["description"].as_str().unwrap();
        assert!(prefix.contains("`ATC_RAT_`"), "{prefix}");
        assert!(prefix.contains("not used when `glob` is set"), "{prefix}");
        assert!(glob.contains("`ATC_*`"), "{glob}");
        assert!(glob.contains("`*RAT*`"), "{glob}");
        let doc = list.iter().find(|tool| tool["name"] == "param_doc").unwrap();
        let names = &doc["parameters"]["properties"]["names"];
        assert!(doc["parameters"]["properties"].get("name").is_none());
        assert!(names["description"].as_str().unwrap().contains("or a list of them"));
        assert_eq!(super::param_names(&json!({"names": "ATC_RAT_RLL_P"})), vec!["ATC_RAT_RLL_P".to_string()]);
        assert_eq!(super::param_names(&json!({"names": ["ATC_RAT_RLL_P", " ATC_RAT_PIT_P "]})), vec!["ATC_RAT_RLL_P".to_string(), "ATC_RAT_PIT_P".to_string()]);
        assert!(desc.contains("write-buffer picture"));
        assert!(!desc.contains("The result note reads"), "{desc}");
        assert!(!desc.contains("It does not name which message was rejected."));
        assert!(!desc.contains("It does not say the storage failed."));
        assert!(!desc.contains("that is not a count of zero."));
        assert!(!desc.contains("means the file ended inside a message"));
        assert!(!desc.contains("LOG_FILE_BUFSIZE"), "{desc}");
        for tool in list {
            let text = tool["description"].as_str().unwrap_or("");
            assert!(!text.contains("The result note reads"), "{}", tool["name"]);
        }
    }

    #[test]
    fn a_text_tool_result_stays_unquoted() {
        let raw = "<metadata>\nok: true\n</metadata>\n<content>\nline {\"a\": true}\n</content>\n";
        assert_eq!(tool_text(&serde_json::Value::String(raw.into())), raw);
        assert_eq!(tool_text(&json!({"ok": true})), r#"{"ok":true}"#);
        let tools = tool_schema();
        let desc = tools.as_array().unwrap().iter()
            .find(|tool| tool["name"] == "firmware_source_read")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(desc.contains("`content` is the file text."));
        assert!(desc.contains("An error is metadata only."));
    }

    #[test]
    fn a_turn_keeps_five_charts_and_the_model_does_not_receive_samples() {
        let mut book = ChartBook::default();
        let draw = json!({ "file": "a", "axes": [] });
        for _ in 0..5 {
            assert!(matches!(admit_chart(&mut book, &draw).unwrap(), ChartSlot::Keep));
        }
        assert!(matches!(admit_chart(&mut book, &draw).unwrap(), ChartSlot::Full));
        assert_eq!(book.n, 5);
        let mut body = json!({
            "ok": true,
            "chart": { "axes": [ { "lines": [ { "name": "actual", "x": [0.0, 1.0], "y": [2.0, 3.0] } ] } ] }
        });
        let shown = tool_text(&body);
        assert!(!shown.contains("\"x\""));
        let brief: serde_json::Value = serde_json::from_str(&shown).unwrap();
        let line = &brief["chart"]["axes"][0]["lines"][0];
        assert_eq!(line["points"], json!(2));
        assert_eq!(line["y_min"], json!(2.0));
        assert_eq!(line["y_max"], json!(3.0));
        assert_eq!(line["x_min"], json!(0.0));
        assert_eq!(line["x_max"], json!(1.0));
        let rows = vec![
            msg(1, "user", "draw"),
            msg(2, "tool", &json!({ "name": "show_chart", "output": body }).to_string()),
        ];
        let kept = plan_context(&rows).recent.into_iter().find(|(role, _)| role == "tool").expect("tool").1;
        assert!(!kept.contains("\"x\""), "{kept}");
        assert!(kept.contains("y_min"), "{kept}");
        scrub_chart(&mut body);
        assert!(body["chart"]["axes"][0]["lines"][0].get("x").is_none());
        let schema = tool_schema();
        let desc = schema.as_array().unwrap().iter()
            .find(|tool| tool["name"] == "show_chart")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(desc.contains("At most 5 charts are shown in one turn."));
        assert!(desc.contains("A later call with the same `slug` replaces that chart."));
        assert!(desc.contains("`remove: true` with that slug removes the chart."));
        assert!(desc.contains("It does not include the samples."));
    }

    #[test]
    fn a_slug_replaces_or_removes_a_chart_without_adding_one() {
        let mut book = ChartBook::default();
        let pitch = json!({ "file": "a", "slug": " pitch ", "axes": [] });
        let revised = json!({ "file": "a", "slug": "pitch", "title": "revised", "axes": [] });
        assert!(matches!(admit_chart(&mut book, &pitch).unwrap(), ChartSlot::Keep));
        assert!(matches!(admit_chart(&mut book, &revised).unwrap(), ChartSlot::Keep));
        assert_eq!(book.n, 1);
        for i in 0..4 {
            let args = json!({ "file": "a", "slug": format!("s{i}"), "axes": [] });
            assert!(matches!(admit_chart(&mut book, &args).unwrap(), ChartSlot::Keep));
        }
        assert_eq!(book.n, 5);
        let extra = json!({ "file": "a", "slug": "extra", "axes": [] });
        assert!(matches!(admit_chart(&mut book, &extra).unwrap(), ChartSlot::Full));
        assert!(matches!(admit_chart(&mut book, &revised).unwrap(), ChartSlot::Keep));
        assert!(matches!(admit_chart(&mut book, &json!({ "slug": "pitch", "remove": true })).unwrap(), ChartSlot::Remove { known: true }));
        assert_eq!(book.n, 4);
        assert!(matches!(admit_chart(&mut book, &extra).unwrap(), ChartSlot::Keep));
        assert!(matches!(admit_chart(&mut book, &json!({ "slug": "missing", "remove": true })).unwrap(), ChartSlot::Remove { known: false }));
        assert_eq!(book.n, 5);
        assert!(admit_chart(&mut book, &json!({ "remove": true })).is_err());
    }

    #[test]
    fn show_live_keeps_one_view_and_names_lines_it_can_draw() {
        let schema = tool_schema();
        let desc = schema.as_array().unwrap().iter()
            .find(|tool| tool["name"] == "show_live")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(desc.contains("At most 5 charts."));
        assert!(desc.contains("At most 8 lines on one chart."));
        assert!(desc.contains("A later call replaces this view."));
        assert!(desc.contains("It does not add a chart."));
        assert!(desc.contains("It does not include samples."));
        let mut sample = Sample::empty();
        sample.params.insert("ATC_ANG_RLL_P".into(), 4.5);
        let value = show_live(&json!({
            "charts": [
                { "title": "rate", "lines": ["ATTITUDE.rollspeed", "ATTITUDE.pitch", "ATC_ANG_RLL_P", "NOT_A_LINE_ZZ"] },
                { "lines": ["ATTITUDE.roll"] }
            ]
        }), &sample);
        assert_eq!(value["ok"], true);
        assert!(value.get("note").is_none());
        assert_eq!(value["charts"][0]["lines"][0]["id"], "ATTITUDE.rollspeed");
        assert_eq!(value["charts"][0]["lines"][2]["id"], "p:ATC_ANG_RLL_P");
        assert_eq!(value["charts"][0]["lines"][2]["kind"], "param");
        assert_eq!(value["charts"][1]["lines"][0]["id"], "ATTITUDE.roll");
        assert_eq!(value["charts"][1]["title"], "ATTITUDE.roll");
        let missing = value["missing"].as_array().unwrap();
        assert!(missing.iter().any(|v| v == "NOT_A_LINE_ZZ"));
        assert!(!value.to_string().contains("\"x\""));
        let mut live_on = false;
        let mut first = value.clone();
        stamp_live("show_live", &mut first, &mut live_on);
        assert_eq!(first["replaced"], false);
        let mut second = value.clone();
        stamp_live("show_live", &mut second, &mut live_on);
        assert_eq!(second["replaced"], true);
        assert!(second["note"].as_str().unwrap().contains("replaces the previous live view"));
        let mut charts = Vec::new();
        for i in 0..6 {
            charts.push(json!({ "title": format!("c{i}"), "lines": ["roll"] }));
        }
        assert_eq!(show_live(&json!({ "charts": charts }), &sample)["ok"], false);
        assert_eq!(show_live(&json!({
            "charts": [{ "lines": ["roll", "pitch", "yaw", "rate", "des", "p", "i", "d", "cmd"] }]
        }), &sample)["ok"], false);
        assert_eq!(show_live(&json!({ "charts": [] }), &sample)["ok"], false);
    }

    #[test]
    fn live_buffer_reads_the_window_and_names_a_gap() {
        let schema = tool_schema();
        let tools = schema.as_array().unwrap();
        let desc = tools.iter()
            .find(|tool| tool["name"] == "live_buffer")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(desc.contains("at most 8"));
        assert!(desc.contains("It does not return every sample."));
        assert!(desc.contains("Recent numbers for live fields"));
        assert!(!desc.contains("The result note reads"));
        assert!(!desc.contains("An empty unit is unknown."));
        assert!(desc.contains("live_fields"));
        assert!(!desc.contains("A parameter is `get_param`"));
        assert!(SKILL_ROOT.contains("The value is `get_param`."));
        let state = tools.iter()
            .find(|tool| tool["name"] == "vehicle_state")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(state.contains("Whether the link is up"));
        assert!(state.contains("vehicle_comment"));
        let comment_tool = tools.iter()
            .find(|tool| tool["name"] == "vehicle_comment")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(comment_tool.contains("stops the turn"));
        assert!(!tools.iter().any(|tool| tool["name"] == "firmware_comment"));
        assert!(!state.contains("`linked: false`"));
        assert!(state.contains('\n'));
        assert!(!desc.contains("rng_m"));
        let fields_desc = tools.iter()
            .find(|tool| tool["name"] == "live_fields")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(fields_desc.contains("MESSAGE.field"));
        assert!(!fields_desc.contains("The result note reads"));
        assert!(!fields_desc.contains("An empty unit is unknown."));
        assert!(!fields_desc.contains("list_params"));
        assert!(!fields_desc.contains("log_params"));
        assert!(!fields_desc.contains("log_schema"));
        assert!(!fields_desc.contains("A live field is not a parameter."));
        assert!(SKILL_ROOT.contains("A live field is not a parameter."));
        assert!(SKILL_ROOT.contains("The value is `log_params`."));
        assert!(SKILL_ROOT.contains("The names come from `log_schema`"));
        let catalog = live_fields(&json!({}));
        assert_eq!(catalog["ok"], true);
        assert!(catalog["fields"].is_object());
        assert!(fields_desc.contains("`fields` is an object."));
        assert!(!fields_desc.contains("`l`"));
        assert!(!fields_desc.contains("`u`"));
        assert!(!fields_desc.contains("only_present"));
        let note = catalog["note"].as_str().unwrap();
        assert!(note.contains("l is a shorter label"));
        assert!(note.contains("u is the unit"));
        assert!(note.contains("An empty unit is unknown."));
        let gap = live_buffer(&json!({ "line": "NOT_A_LINE" }));
        assert!(gap["note"].as_str().unwrap().contains("An empty unit is unknown."));
        assert!(gap["note"].as_str().unwrap().contains("missing is not a live field."));
        let live = tools.iter()
            .find(|tool| tool["name"] == "show_live")
            .and_then(|tool| tool["description"].as_str())
            .unwrap();
        assert!(live.contains("live_fields"));
        assert!(!live.contains("rng_m"));
        assert!(SKILL_ROOT.contains("live_fields"));
        assert!(SKILL_ROOT.contains("logged parameter"));
        assert!(SKILL_ROOT.contains("log field"));
        assert!(!SKILL_ROOT.contains("rng_m"));
        assert!(!SKILL_ROOT.contains("sonarrange"));
        assert!(SKILL_ROOT.contains("live_buffer"));
        assert!(SKILL_ROOT.contains("https://github.com/alex-pokydin/ArduLoops/issues"));
        assert!(SKILL_ROOT.contains("## This station"));
        assert!(SKILL_ROOT.contains("It is reported when the user asked for it, the request makes sense for this station, and nothing here does it."));
        assert!(SKILL_ROOT.contains("A part is a tool, a control on the screen, a drawing, or another action."));
        assert!(SKILL_ROOT.contains("When the user asked what is missing and no such part remains, the answer is that nothing needs to be added."));
        assert!(SKILL_ROOT.contains("The first sentence says how that loop behaved"));
        assert!(SKILL_ROOT.contains("Read one loop in this order."));
        assert!(SKILL_ROOT.contains("It does not say the controller delayed by that time."));
        assert!(SKILL_ROOT.contains("A large `d_share` is the D column following faster changes."));
        assert!(SKILL_ROOT.contains("A span is not a scale for an altitude error."));
        assert!(SKILL_ROOT.contains("`firmware_library` returns the same text as `controller.comment`."));
        assert!(SKILL_ROOT.contains("Do not ask when neither result is in this conversation."));
        assert!(!SKILL_ROOT.contains("SIM_FRM_"));
        assert!(!SKILL_ROOT.contains("Ask for the span, the mass, and the propeller size"));
        assert!(SKILL_ROOT.contains("A transient is an entry of `holds`"));
        assert!(SKILL_ROOT.contains("`sides` splits the samples in `active_count` into `beyond` and `short`."));
        assert!(SKILL_ROOT.contains("The entries are not an average."));
        assert!(SKILL_ROOT.contains("When `sample_hz` is coarse beside that motion, the measurement does not support a gain change."));
        assert!(SKILL_ROOT.contains("Do not tell the user to open Mission Planner"));
        assert!(!SKILL_ROOT.contains("`present`"));
        assert!(!SKILL_ROOT.contains("`l` is a shorter"));
        assert_eq!(live_buffer(&json!({}))["ok"], false);
        assert_eq!(live_buffer(&json!({
            "lines": ["roll", "pitch", "yaw", "rate", "des", "p", "i", "d", "cmd"]
        }))["ok"], false);
        let drawn = show_live(&json!({
            "charts": [{ "lines": ["DISTANCE_SENSOR.current_distance", "OPTICAL_FLOW.quality"] }]
        }), &Sample::empty());
        assert_eq!(drawn["ok"], true);
        assert_eq!(drawn["charts"][0]["lines"][0]["id"], "DISTANCE_SENSOR.current_distance");
        assert_eq!(drawn["charts"][0]["lines"][1]["id"], "OPTICAL_FLOW.quality");
    }

    #[test]
    fn a_computation_is_kept_whole() {
        let mut results = Vec::new();
        for i in 0..6 {
            results.push(json!({
                "op": "track",
                "error_rms": i,
                "holds": [{ "command": 10.0 + i as f64 }],
                "note": "n".repeat(60_000),
            }));
        }
        let full = json!({ "ok": true, "count": 6, "results": results });
        let kept = fit_result("log_compute", full.clone());
        assert!(kept.get("truncated").is_none(), "{kept}");
        assert_eq!(kept["results"][5]["holds"][0]["command"], json!(15.0), "{kept}");
        let cut = fit_result("firmware_source_read", full.clone());
        assert_eq!(cut["truncated"], json!(true), "{cut}");
        let schema = fit_result("log_schema", full.clone());
        assert!(schema.get("truncated").is_none(), "{schema}");

        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE ai_message (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        ).unwrap();
        note_tool(&c, "c", "log_compute", &json!({}), &full);
        let body: String = c.query_row("SELECT body FROM ai_message WHERE role='tool'", [], |row| row.get(0)).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(saved["output"].get("preview").is_none(), "{saved}");
        assert_eq!(saved["output"]["results"][5]["error_rms"], json!(5), "{saved}");
    }

    #[test]
    fn a_stopped_turn_is_named_and_a_waiting_card_is_not() {
        assert_eq!(provider_failure("empty provider response"), "The model returned no text.");
        assert_eq!(
            provider_failure("400 the input token count exceeds the maximum number of input tokens"),
            "The model rejected this turn because the request was too long.",
        );
        let body = failure_body(
            "400 the input token count exceeds the maximum number of input tokens",
            "The model rejected this turn because the request was too long.",
        );
        assert!(body.contains("token count"), "{body}");
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE ai_chat (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
             CREATE TABLE ai_message (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE ai_proposal (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, status TEXT NOT NULL, param TEXT NOT NULL, old_value REAL, new_value REAL NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);",
        ).unwrap();
        c.execute("INSERT INTO ai_chat (id, title, created_at, updated_at) VALUES ('open', 't', 1, 1)", []).unwrap();
        c.execute("INSERT INTO ai_chat (id, title, created_at, updated_at) VALUES ('card', 't', 1, 1)", []).unwrap();
        c.execute("INSERT INTO ai_message (chat_id, role, body, created_at) VALUES ('open', 'tool', '{}', 1)", []).unwrap();
        c.execute("INSERT INTO ai_message (chat_id, role, body, created_at) VALUES ('card', 'tool', '{}', 1)", []).unwrap();
        c.execute("INSERT INTO ai_proposal (id, chat_id, status, param, old_value, new_value, reason, created_at) VALUES ('p', 'card', 'pending', 'Connect', NULL, 0, '', 1)", []).unwrap();
        note_stopped_turns_on(&c);
        let open: String = c.query_row("SELECT body FROM ai_message WHERE chat_id='open' AND role='assistant'", [], |row| row.get(0)).unwrap();
        assert_eq!(open, "This turn stopped before a reply.");
        let card: i64 = c.query_row("SELECT COUNT(*) FROM ai_message WHERE chat_id='card' AND role='assistant'", [], |row| row.get(0)).unwrap();
        assert_eq!(card, 0);
    }

    #[test]
    fn a_steer_becomes_a_user_message_when_the_turn_takes_it() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE ai_message (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        ).unwrap();
        c.execute("INSERT INTO ai_message (chat_id, role, body, created_at) VALUES ('c', 'steer', 'waiting', 1)", []).unwrap();
        c.execute("INSERT INTO ai_message (chat_id, role, body, created_at) VALUES ('c', 'steer', 'during', 2)", []).unwrap();
        claim_steers_through(&c, "c", 1);
        let waiting: String = c.query_row("SELECT role FROM ai_message WHERE body='waiting'", [], |row| row.get(0)).unwrap();
        let during: String = c.query_row("SELECT role FROM ai_message WHERE body='during'", [], |row| row.get(0)).unwrap();
        assert_eq!(waiting, "user");
        assert_eq!(during, "steer");
        let mut after = 1i64;
        let note = drain_steers(&c, "c", &mut after).unwrap();
        assert_eq!(note, "during");
        assert_eq!(after, 2);
        let during: String = c.query_row("SELECT role FROM ai_message WHERE body='during'", [], |row| row.get(0)).unwrap();
        assert_eq!(during, "user");
    }

    #[test]
    fn a_stopped_turn_releases_the_next_message() {
        let first = begin_live("stopped-chat");
        assert!(turn_is_live("stopped-chat"));
        halt_turn();
        assert!(turn_is_live("stopped-chat"));
        assert!(turn_halted());
        end_live(first);
        assert!(!turn_is_live("stopped-chat"));
        let second = begin_live("stopped-chat");
        assert_ne!(first, second);
        assert!(turn_is_live("stopped-chat"));
        assert!(!turn_halted());
        end_live(second);
        assert!(!turn_is_live("stopped-chat"));
    }

    #[test]
    fn a_param_audit_detail_is_json() {
        let text = change_detail(Some(0.00800000037997961), 0.006, "batch-1");
        assert!(!text.contains("Some("));
        let value: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert!((value["old"].as_f64().unwrap() - 0.008).abs() < 1e-9);
        assert!((value["requested"].as_f64().unwrap() - 0.006).abs() < 1e-9);
        assert_eq!(value["batch"], "batch-1");
        let plain = change_detail(None, 1.2, "");
        assert!(plain.contains("\"old\":null"));
        assert!(!plain.contains("batch"));
        assert_eq!(batch_token(&json!({"batch": "batch-1"})), "batch-1");
        assert!(batch_token(&json!({"batch": "bad id"})).is_empty());
    }

    #[test]
    fn a_ui_note_keeps_a_settled_change() {
        let notes = ui_notes(&json!({
            "changes": [
                {"kind": "param", "name": "ATC_RAT_RLL_P", "from": 0.135, "value": 0.135},
                {"kind": "param", "name": "ATC_RAT_RLL_P", "from": 0.135, "value": 0.2},
                {"kind": "param", "name": "ATC_RAT_PIT_P", "from": 0.135, "value": 0.2}
            ]
        })).expect("notes");
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].0, "param ATC_RAT_RLL_P");
        assert!(notes[0].1.is_empty());
        let detail: serde_json::Value = serde_json::from_str(&notes[0].2).expect("json");
        assert_eq!(detail["batch"], serde_json::from_str::<serde_json::Value>(&notes[1].2).unwrap()["batch"]);
        let mode = ui_notes(&json!({"changes": [{"kind": "mode", "from": "ALT_HOLD", "mode": "LOITER"}]})).unwrap();
        assert_eq!(mode, vec![("mode".into(), "ALT_HOLD → LOITER".into(), String::new())]);
        let arm = ui_notes(&json!({"changes": [{"kind": "arm", "on": false}]})).unwrap();
        assert_eq!(arm[0].0, "disarm");
        assert_eq!(arm[0].1, "disarmed");
        assert!(ui_notes(&json!({"changes": [{"kind": "stick"}]})).is_err());
    }

    #[test]
    fn a_fresh_link_needs_a_recent_heartbeat() {
        let now = 1_000.0;
        assert!(link_fresh(&json!({"ok": true, "heartbeat_at": 998.0}), now));
        assert!(!link_fresh(&json!({"ok": true, "heartbeat_at": 990.0}), now));
        assert!(!link_fresh(&json!({"ok": false, "heartbeat_at": 999.0}), now));
    }

    #[test]
    fn an_open_link_is_not_opened_again() {
        let now = 1_000.0;
        let state = json!({"ok": true, "heartbeat_at": 999.0, "detail": "serial:COM11:115200"});
        assert!(connect_already_up(&state, "serial:COM11:115200", now));
        assert!(connect_already_up(&state, "serial:com11:115200", now));
        assert!(!connect_already_up(&state, "serial:COM12:115200", now));
        assert!(!connect_already_up(&json!({"ok": true, "heartbeat_at": 990.0, "detail": "serial:COM11:115200"}), "serial:COM11:115200", now));
    }

    #[test]
    fn an_applied_connect_keeps_the_link_snapshot() {
        let item = outcome_item(
            "applied",
            "Connect",
            None,
            0.0,
            r#"{"linked":true,"detail":"serial:COM11:115200","already_linked":true,"note":"left as it was"}"#,
        );
        assert_eq!(item["linked"], json!(true));
        assert_eq!(item["detail"], json!("serial:COM11:115200"));
        assert_eq!(item["already_linked"], json!(true));
        assert!(item["note"].as_str().unwrap_or("").contains("left as it was"));
    }

    #[test]
    fn the_note_keeps_every_heading() {
        let prompt = compact_prompt("<previous_note>\n(none)\n</previous_note>");
        for heading in ["Constraints:", "Decisions:", "Findings:", "Vehicle:", "Open:"] {
            assert!(prompt.contains(heading), "{heading}");
        }
        assert!(prompt.contains("write none"));
        assert!(prompt.contains("the turn replaces the note"));
        assert!(prompt.contains("8000 characters"));
    }

    #[test]
    fn an_attached_log_is_named_as_the_file_argument() {
        let note = attached_log_note("002F/094d906674953735_20260929211739_3.bin");
        assert!(note.contains("file is 002F/094d906674953735_20260929211739_3.bin"));
        assert!(note.contains("may not repeat"));
        let prompt = conversation_prompt("user: look at the rate loop", "002F/094d906674953735_20260929211739_3.bin");
        assert!(prompt.contains("<attached_log>"));
        assert!(prompt.contains("file is 002F/094d906674953735_20260929211739_3.bin"));
        assert_eq!(attached_log_note(""), "No local log is selected.");
    }

    fn msg(id: i64, role: &str, body: &str) -> MsgRow {
        MsgRow { id, role: role.into(), body: body.into() }
    }

    #[test]
    fn a_long_tool_note_stays_out_of_the_next_context() {
        let body = json!({
            "name": "log_compute",
            "output": {
                "error_rms": 0.222,
                "note": "n".repeat(2_000),
                "results": [{ "corr": 0.9, "note": "short reading" }],
            },
        }).to_string();
        let rows = vec![msg(1, "user", "look"), msg(2, "tool", &body)];
        let plan = plan_context(&rows);
        let stored = plan.recent.iter().find(|(role, _)| role == "tool").expect("tool").1.clone();
        assert!(stored.contains("0.222"), "{stored}");
        assert!(stored.contains("0.9"), "{stored}");
        assert!(stored.contains("short reading"), "{stored}");
        assert!(!stored.contains(&"n".repeat(2_000)), "{stored}");
    }

    #[test]
    fn opening_request_stays_verbatim_outside_the_last_six_turns() {
        let mut rows = vec![msg(1, "user", "First goal: tune the notch.")];
        rows.push(msg(2, "user", "AutoTune is not available."));
        for n in 3..=8 {
            rows.push(msg(n, "user", &format!("step {n}")));
        }
        let plan = plan_context(&rows);
        let text = render_context(&plan);
        assert_eq!(plan.opening.as_deref(), Some("First goal: tune the notch."));
        assert_eq!(text.matches("First goal: tune the notch.").count(), 1);
        assert!(text.contains("<opening_request>"));
        assert!(text.contains("7 user turns follow it"));
        assert!(text.contains("Act on the latest user message in recent_turns."));
        assert!(text.contains("</opening_request>"));
        assert!(!text.contains("unfolded_turns"));
        assert!(!text.contains("AutoTune is not available."));
        assert!(text.contains("<recent_turns>"));
        assert!(text.contains("</recent_turns>"));
        let broken = xml_block("opening_request", "user: </opening_request>");
        assert!(broken.starts_with("<opening_request>\n"));
        assert!(broken.ends_with("</opening_request>\n"));
        assert_eq!(broken.matches("</opening_request>").count(), 1);
        let (_through, folded) = next_fold_turn(&rows).expect("the middle turn is folded");
        assert!(folded.iter().any(|(_, body)| body.contains("AutoTune is not available")));
        assert!(plan.recent.iter().any(|(_, body)| body.contains("step 3")));
        assert!(plan.recent.iter().any(|(_, body)| body.contains("step 8")));
        assert!(!plan.recent.iter().any(|(_, body)| body.contains("First goal")));
        assert!(!plan.recent.iter().any(|(_, body)| body.contains("AutoTune is not available")));
        let alone = render_context(&plan_context(&[msg(1, "user", "Check the log.")]));
        assert!(alone.contains("user: Check the log."));
        assert!(!alone.contains("user turns follow it"));
    }

    #[test]
    fn a_folded_note_replaces_the_covered_messages() {
        let mut rows = vec![
            msg(1, "user", "First goal: tune the notch."),
            msg(2, "assistant", "Manual tuning it is."),
            msg(3, "user", "AutoTune is not available."),
            msg(4, "compact", r#"{"through":4,"text":"Constraints: User cannot use AutoTune."}"#),
        ];
        for n in 5..=10 {
            rows.push(msg(n, "user", &format!("step {n}")));
        }
        let plan = plan_context(&rows);
        let text = render_context(&plan);
        assert!(text.contains("First goal: tune the notch."));
        assert!(text.contains("User cannot use AutoTune"));
        assert!(!text.contains("Manual tuning it is."));
        assert!(!text.contains("AutoTune is not available."));
        assert!(text.contains("step 10"));
    }

    #[test]
    fn the_recent_turns_keep_six_tool_rows() {
        let mut rows = vec![msg(1, "user", "Check the log.")];
        for i in 0..20 {
            rows.push(msg(2 + i, "tool", &format!("batch {i}")));
        }
        rows.push(msg(30, "assistant", "Done."));
        rows.push(msg(31, "user", "Apply it."));
        let plan = plan_context(&rows);
        let tools: Vec<_> = plan.recent.iter().filter(|(role, _)| role == "tool").map(|(_, body)| body.clone()).collect();
        assert_eq!(tools.len(), 20);
        assert!(tools[0].contains("batch 0"));
        assert!(tools[19].contains("batch 19"));
    }

    #[test]
    fn a_large_window_keeps_two_turns_and_folds_the_rest() {
        let mut rows = vec![msg(1, "user", "First.")];
        for n in 2..=9 {
            rows.push(msg(n * 10, "user", &format!("turn {n} {}", "y".repeat(30_000))));
        }
        let plan = plan_context(&rows);
        let users: Vec<_> = plan.recent.iter().filter(|(role, _)| role == "user").map(|(_, body)| body.clone()).collect();
        assert_eq!(users.len(), 5);
        assert!(users[0].contains("turn 5"));
        assert!(users[4].contains("turn 9"));
        assert!(!users.iter().any(|body| body.contains("turn 4")));
        let (_through, lines) = next_fold_turn(&rows).expect("dropped turns are folded");
        assert!(lines.iter().any(|(_, body)| body.contains("turn 2")));
        assert!(!lines.iter().any(|(_, body)| body.contains("turn 8")));
    }

    #[test]
    fn the_next_summary_adds_one_turn() {
        let mut rows = vec![
            msg(1, "user", "First goal: tune the notch."),
            msg(2, "user", "AutoTune is not available."),
            msg(3, "assistant", "Manual tuning it is."),
            msg(4, "tool", "notch peak 118 Hz"),
        ];
        for n in 5..=10 {
            rows.push(msg(n, "user", &format!("step {n}")));
        }
        let (through, lines) = next_fold_turn(&rows).expect("one turn");
        assert_eq!(through, 4);
        assert!(lines.iter().any(|(_, body)| body.contains("AutoTune is not available")));
        assert!(lines.iter().any(|(_, body)| body.contains("Manual tuning")));
        assert!(lines.iter().any(|(_, body)| body.contains("118 Hz")));
        assert!(!lines.iter().any(|(_, body)| body.contains("step ")));
        rows.push(msg(11, "compact", r#"{"through":4,"text":"Constraints: no AutoTune."}"#));
        assert!(next_fold_turn(&rows).is_none());
        rows.push(msg(12, "user", "step 12"));
        let (through, lines) = next_fold_turn(&rows).expect("the turn that left the window");
        assert_eq!(through, 5);
        assert!(lines.iter().any(|(_, body)| body.contains("step 5")));
        assert!(!lines.iter().any(|(_, body)| body.contains("step 6")));
        assert!(!lines.iter().any(|(_, body)| body.contains("AutoTune")));
    }

    #[test]
    fn a_download_wait_follows_the_log_size() {
        assert_eq!(log_download_wait_s(0, None), 180);
        assert_eq!(log_download_wait_s(8_449_246, None), 1_498);
        assert_eq!(log_download_wait_s(8_449_246, Some(30)), 30);
        assert_eq!(log_download_wait_s(8_449_246, Some(99_999)), 3_600);
        assert!(call_again(&json!({"error": "DataFlash log download is still in progress; try the same log ID again"})));
        assert!(!call_again(&json!({"id": "logs/a.bin", "complete": true})));
    }

    #[test]
    fn provider_model_uses_the_saved_provider() {
        assert_eq!(provider_model("gemini", "gemini-custom").unwrap().adapter_kind, genai::adapter::AdapterKind::Gemini);
        assert_eq!(provider_model("openai", "gpt-custom").unwrap().adapter_kind, genai::adapter::AdapterKind::OpenAI);
        assert_eq!(provider_model("xai", "grok-custom").unwrap().adapter_kind, genai::adapter::AdapterKind::Xai);
        assert_eq!(provider_model("anthropic", "claude-custom").unwrap().adapter_kind, genai::adapter::AdapterKind::Anthropic);
        assert!(provider_model("other", "m").is_err());
    }

    #[test]
    fn chat_tools_follow_the_schema() {
        let tools = chat_tools();
        let schema = tool_schema();
        let listed = schema.as_array().expect("schema");
        assert_eq!(tools.len(), listed.len());
        assert!(tools.iter().any(|tool| tool.name.to_string() == "log_compute"));
        assert!(tools.iter().any(|tool| tool.name.to_string() == "wizard_widget"));
        assert!(wizard_name_ok("accel") && wizard_name_ok("compass") && wizard_name_ok("compass_mot") && wizard_name_ok("motors") && wizard_name_ok("radio") && wizard_name_ok("modes") && wizard_name_ok("battery"));
        assert!(!wizard_name_ok("horizon") && !wizard_name_ok(""));
        assert_eq!(wizard_line(&json!({"title": "  Калібрування   компаса  "}), "title", 80).unwrap(), "Калібрування компаса");
        assert!(wizard_line(&json!({"title": ""}), "title", 80).is_err());
        assert!(wizard_line(&json!({"title": "x".repeat(81)}), "title", 80).is_err());
        assert!(tools.iter().any(|tool| tool.schema.is_some()));
    }

    #[test]
    fn quiet_models_keep_reasoning_effort_none() {
        assert!(matches!(reasoning_effort("openai", "gpt-6-sol", "high"), Some(genai::chat::ReasoningEffort::None)));
        assert!(matches!(reasoning_effort("xai", "gpt-6-luna", ""), Some(genai::chat::ReasoningEffort::None)));
        assert!(reasoning_effort("openai", "gpt-4.1", "high").is_none());
        assert!(matches!(reasoning_effort("gemini", "gemini-3", "medium"), Some(genai::chat::ReasoningEffort::Medium)));
        assert!(reasoning_effort("gemini", "gemini-3", "").is_none());
        let quiet = turn_options("openai", "gpt-6-sol", "high");
        assert!(matches!(quiet.reasoning_effort, Some(genai::chat::ReasoningEffort::None)));
        assert_eq!(turn_options("anthropic", "claude", "low").max_tokens, Some(1200));
    }

    #[test]
    fn a_steer_joins_the_open_user_message() {
        let mut messages = vec![genai::chat::ChatMessage::user("measure the rate loop")];
        append_steer(&mut messages, "use the attached file");
        assert_eq!(messages.len(), 1);
        assert!(messages[0].content.texts().join("\n").contains("steer: use the attached file"));
        messages.push(genai::chat::ChatMessage::assistant("looking"));
        append_steer(&mut messages, "also pitch");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2].role, genai::chat::ChatRole::User);
    }

    #[test]
    fn thoughts_stay_until_the_next_one_and_the_reply_replaces_them() {
        let gen = begin_live("thought-accumulate");
        live_thought("Stabilize, then AltHold");
        live_thought("Stabilize, then AltHold. FlowHold is next.");
        let growing = live_status("thought-accumulate")["thought"].as_str().unwrap().to_string();
        assert_eq!(growing, "Stabilize, then AltHold. FlowHold is next.");
        live_thinking();
        assert_eq!(live_status("thought-accumulate")["thought"], "Stabilize, then AltHold. FlowHold is next.");
        live_thought("track the rate loop");
        let both = live_status("thought-accumulate")["thought"].as_str().unwrap().to_string();
        assert!(both.starts_with("Stabilize, then AltHold. FlowHold is next."));
        assert!(both.ends_with("track the rate loop"));
        live_reply("the report");
        let shown = live_status("thought-accumulate");
        assert_eq!(shown["reply"], "the report");
        assert!(shown["thought"].as_str().unwrap().contains("track the rate loop"));
        end_live(gen);
    }

    #[test]
    #[ignore = "calls the configured provider"]
    fn a_configured_provider_replies() {
        let secrets = load_secrets();
        let ready: Vec<_> = secrets.into_iter().filter(|(_, key)| !key.trim().is_empty()).collect();
        if ready.is_empty() {
            return;
        }
        for (provider, key) in ready {
            let model = saved_provider_model(&provider).unwrap_or_else(|| default_model(&provider).to_string());
            let text = call_provider(&provider, &model, &key, "Reply with the single word OK.", &[])
                .unwrap_or_else(|err| panic!("{provider} {model} compact: {err}"));
            assert!(!text.trim().is_empty(), "{provider} {model} compact");
            let messages = vec![genai::chat::ChatMessage::user("Reply with the single word OK.")];
            let turn = provider_turn(&provider, &model, &key, "low", "Reply with the single word OK.", &messages)
                .unwrap_or_else(|err| panic!("{provider} {model} stream: {err}"));
            assert!(turn.calls.is_empty(), "{provider} {model} stream called a tool");
            assert!(!turn.text.trim().is_empty(), "{provider} {model} stream");
            let ask = vec![genai::chat::ChatMessage::user("Call vehicle_state now.")];
            let tool_turn = provider_turn(&provider, &model, &key, "low", "Call the vehicle_state tool. Do not answer before that call.", &ask)
                .unwrap_or_else(|err| panic!("{provider} {model} tools: {err}"));
            assert!(tool_turn.calls.iter().any(|call| call.fn_name == "vehicle_state"), "{provider} {model} did not call vehicle_state");
            let assistant = tool_turn.assistant.expect("tool turn keeps the assistant message");
            let responses: Vec<genai::chat::ToolResponse> = tool_turn.calls.iter().map(|call| {
                genai::chat::ToolResponse::from_tool_call(call, r#"{"linked":false}"#)
            }).collect();
            let mut follow = ask;
            follow.push(assistant);
            follow.push(genai::chat::ChatMessage::tool(responses));
            let next = provider_turn(&provider, &model, &key, "low", "Call the vehicle_state tool. Do not answer before that call.", &follow)
                .unwrap_or_else(|err| panic!("{provider} {model} tool result: {err}"));
            assert!(!next.text.trim().is_empty() || !next.calls.is_empty(), "{provider} {model} tool result");
        }
    }

    #[test]
    fn script_edits_wait_for_a_card() {
        let tools = tool_schema();
        let list = tools.as_array().expect("schema");
        for name in ["script_write", "script_delete", "script_restart"] {
            let desc = list.iter()
                .find(|tool| tool["name"] == name)
                .and_then(|tool| tool["description"].as_str())
                .unwrap_or("");
            assert!(desc.contains("card"), "{name}: {desc}");
            assert!(desc.contains("Safe mode does not skip"), "{name}");
        }
        let write = list.iter()
            .find(|tool| tool["name"] == "script_write")
            .and_then(|tool| tool["description"].as_str())
            .unwrap_or("");
        assert!(write.contains("English ASCII"), "{write}");
        assert!(write.contains("Only comments may be in the user's language"), "{write}");
        let read = list.iter()
            .find(|tool| tool["name"] == "script_read")
            .and_then(|tool| tool["description"].as_str())
            .unwrap_or("");
        assert!(read.contains("Lua editor quote"), "{read}");
        assert!(SKILL_ROOT.contains("When it is off, set `SCR_ENABLE` to 1 and reboot."));
        assert!(!write.contains("If scripting is off"), "{write}");
    }

    #[test]
    fn a_script_quote_keeps_the_selection_and_the_source() {
        let body = json!({
            "name": "ccrp.lua",
            "start": 25,
            "end": 31,
            "selection": "local x = 1",
            "body": "full source",
            "dirty": true,
        }).to_string();
        let rows = vec![
            MsgRow { id: 1, role: "user".into(), body: "why this line".into() },
            MsgRow { id: 2, role: "quote".into(), body },
        ];
        let text = render_context(&plan_context(&rows));
        assert!(text.contains("why this line"), "{text}");
        assert!(text.contains("ccrp.lua"), "{text}");
        assert!(text.contains("lines 25-31"), "{text}");
        assert!(text.contains("local x = 1"), "{text}");
        assert!(text.contains("full source"), "{text}");
        assert!(text.contains("unsaved"), "{text}");
        assert!(text.contains("script_read"), "{text}");
    }

    fn saved_provider_model(provider: &str) -> Option<String> {
        let path = crate::db::data_dir().join("catalog.sqlite3");
        let connection = Connection::open(path).ok()?;
        connection.query_row(
            "SELECT model FROM ai_provider WHERE provider=?1 AND model<>''",
            [provider],
            |row| row.get(0),
        ).ok()
    }
}
