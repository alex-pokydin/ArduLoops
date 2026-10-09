#![recursion_limit = "256"]

mod agent;
mod cli;
mod db;
mod dflog;
mod firmware;
mod firmware_native;
mod http;
mod link;
mod mcp;
mod migrate;
mod ports;
mod research;
#[cfg(not(target_os = "android"))]
mod serial_link;
mod sitl;
mod tlog;
mod udp;

pub fn migrate_force(on: bool) {
    migrate::force_latest(on);
}

pub fn wants_mcp(args: &[String]) -> bool {
    matches!(args.first().map(String::as_str), Some("mcp" | "--mcp"))
}

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use crate::http::HTTP_ADDR;
use crate::link::{Cmd, OnSample, Sample};

pub fn run_cli(args: &[String]) -> i32 {
    if args.first().map(String::as_str) == Some("--firmware-worker") {
        return args
            .get(1)
            .map(|id| {
                firmware_native::run_worker(id)
                    .map(|_| 0)
                    .unwrap_or_else(|e| {
                        eprintln!("{e}");
                        1
                    })
            })
            .unwrap_or(2);
    }
    cli::run(args)
}

fn spawn_backend(rx: std::sync::mpsc::Receiver<Cmd>, tx_http: Sender<Cmd>, on_sample: OnSample) {
    let latest = Arc::new(Mutex::new(Sample::empty()));
    let url = Arc::new(Mutex::new(String::new()));
    let sitl = sitl::SitlCtl::new();
    let latest_http = latest.clone();
    let sitl_loop = sitl.clone();
    std::thread::spawn(move || http::serve(HTTP_ADDR, latest_http, tx_http));
    std::thread::spawn(move || link::run_loop(on_sample, rx, latest, url, sitl_loop));
}

pub fn run_bridge() {
    agent::note_stopped_turns();
    let (tx, rx) = mpsc::channel::<Cmd>();
    println!("ArduLoops  http://{HTTP_ADDR}  (headless MAVLink for the browser UI)");
    println!("UI         http://127.0.0.1:5173");
    spawn_backend(rx, tx, Arc::new(|_: &Sample| {}));
    loop {
        std::thread::park();
    }
}

#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
    use std::sync::OnceLock;
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn open_system_url(url: &str) -> Result<(), String> {
        let app = APP.get().ok_or_else(|| "open the link in the browser".to_string())?;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|err| err.to_string())
    }

    pub fn run() {
        let (tx, rx) = mpsc::channel::<Cmd>();
        tauri::Builder::default()
            .plugin(tauri_plugin_log::Builder::default().build())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_deep_link::init())
            .setup(move |app| {
                if let Ok(path) = app.path().app_local_data_dir() {
                    crate::db::set_app_data_dir(path);
                }
                crate::agent::note_stopped_turns();
                spawn_backend(rx, tx, Arc::new(|_: &Sample| {}));
                let _ = APP.set(app.handle().clone());
                {
                    use tauri_plugin_deep_link::DeepLinkExt;
                    let _ = app.deep_link().on_open_url(|event| {
                        for item in event.urls() {
                            crate::agent::complete_auth_url(item.as_str());
                        }
                    });
                    if let Ok(Some(urls)) = app.deep_link().get_current() {
                        for item in urls {
                            crate::agent::complete_auth_url(item.as_str());
                        }
                    }
                }
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running ArduLoops");
    }
}

#[cfg(feature = "desktop")]
pub fn open_system_url(url: &str) -> Result<(), String> {
    desktop::open_system_url(url)
}

#[cfg(not(feature = "desktop"))]
pub fn open_system_url(_: &str) -> Result<(), String> {
    Err("open the link in the browser".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
