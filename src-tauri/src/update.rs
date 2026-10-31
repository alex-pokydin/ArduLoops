//! Install a newer release in place. The desktop app downloads the signed installer
//! named in the release's latest.json, runs it, and restarts. Status is polled with /app.
use std::sync::Mutex;

use serde_json::{json, Value};

#[derive(Clone)]
#[cfg_attr(not(all(feature = "desktop", not(target_os = "android"))), allow(dead_code))]
enum State {
    Idle,
    Checking,
    Downloading { done: u64, total: Option<u64> },
    Installing,
    Missing,
    Failed(String),
}

static STATE: Mutex<State> = Mutex::new(State::Idle);

fn set(state: State) {
    if let Ok(mut guard) = STATE.lock() {
        *guard = state;
    }
}

pub fn status() -> Value {
    let state = STATE.lock().map(|guard| guard.clone()).unwrap_or(State::Idle);
    let can = supported();
    match state {
        State::Idle => json!({ "can": can, "state": "idle" }),
        State::Checking => json!({ "can": can, "state": "checking" }),
        State::Downloading { done, total } => {
            json!({ "can": can, "state": "downloading", "done": done, "total": total })
        }
        State::Installing => json!({ "can": can, "state": "installing" }),
        State::Missing => json!({ "can": can, "state": "missing" }),
        State::Failed(error) => json!({ "can": can, "state": "failed", "error": error }),
    }
}

/// Starts the check, download, and install in the background. Returns false when one is already running.
pub fn start() -> bool {
    if let Ok(mut guard) = STATE.lock() {
        if matches!(*guard, State::Checking | State::Downloading { .. } | State::Installing) {
            return false;
        }
        *guard = State::Checking;
    }
    let started = std::thread::Builder::new()
        .name("arduloops-update".into())
        .spawn(|| match run() {
            Ok(true) => {}
            Ok(false) => set(State::Missing),
            Err(error) => set(State::Failed(error)),
        })
        .is_ok();
    if !started {
        set(State::Failed("Could not start the update".into()));
    }
    started
}

// macOS releases are built with --no-sign, which also skips the updater signature.
#[cfg(all(feature = "desktop", not(target_os = "android")))]
fn supported() -> bool {
    !cfg!(target_os = "macos") && crate::app_handle().is_some()
}

#[cfg(not(all(feature = "desktop", not(target_os = "android"))))]
fn supported() -> bool {
    false
}

#[cfg(all(feature = "desktop", not(target_os = "android")))]
fn run() -> Result<bool, String> {
    use tauri_plugin_updater::UpdaterExt;

    let app = crate::app_handle().ok_or_else(|| "The updater is not available".to_string())?;
    tauri::async_runtime::block_on(async move {
        let updater = app.updater().map_err(|e| e.to_string())?;
        let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
            return Ok(false);
        };
        set(State::Downloading { done: 0, total: None });
        let mut done: u64 = 0;
        update
            .download_and_install(
                |chunk, total| {
                    done += chunk as u64;
                    set(State::Downloading { done, total });
                },
                || set(State::Installing),
            )
            .await
            .map_err(|e| e.to_string())?;
        // Windows exits inside download_and_install while the installer runs. Other platforms restart here.
        app.restart()
    })
}

#[cfg(not(all(feature = "desktop", not(target_os = "android"))))]
fn run() -> Result<bool, String> {
    Err("Install the update from the release page".into())
}
