mod cli;
mod http;
mod link;
mod mcp;
mod ports;
mod sitl;
mod udp;

pub fn wants_mcp(args: &[String]) -> bool {
    matches!(args.first().map(String::as_str), Some("mcp" | "--mcp"))
}

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use crate::http::HTTP_ADDR;
use crate::link::{Cmd, OnSample, Sample};

pub fn run_cli(args: &[String]) -> i32 {
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

    pub fn run() {
        let (tx, rx) = mpsc::channel::<Cmd>();
        tauri::Builder::default()
            .plugin(tauri_plugin_log::Builder::default().build())
            .setup(move |_app| {
                spawn_backend(rx, tx, Arc::new(|_: &Sample| {}));
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running ArduLoops");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
