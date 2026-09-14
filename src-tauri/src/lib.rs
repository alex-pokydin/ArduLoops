mod cli;
mod http;
mod link;

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use crate::http::HTTP_ADDR;
use crate::link::{Cmd, Sample, DEFAULT_URL, OnSample};

pub fn run_cli(args: &[String]) -> i32 {
    cli::run(args)
}

fn spawn_backend(rx: std::sync::mpsc::Receiver<Cmd>, tx_http: Sender<Cmd>, on_sample: OnSample) {
    let latest = Arc::new(Mutex::new(Sample::empty()));
    let url = Arc::new(Mutex::new(DEFAULT_URL.to_string()));
    let latest_http = latest.clone();
    std::thread::spawn(move || http::serve(HTTP_ADDR, latest_http, tx_http));
    std::thread::spawn(move || link::run_loop(on_sample, rx, latest, url));
}

pub fn run_bridge() {
    let (tx, rx) = mpsc::channel::<Cmd>();
    println!("ArduLoops bridge  http://{HTTP_ADDR}");
    println!("UI  http://127.0.0.1:5173");
    spawn_backend(rx, tx, Arc::new(|_: &Sample| {}));
    loop {
        std::thread::park();
    }
}

#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
    use tauri::Emitter;

    struct CmdTx(Mutex<Sender<Cmd>>);

    #[tauri::command]
    fn mav_cmd(state: tauri::State<CmdTx>, cmd: Cmd) -> Result<(), String> {
        state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .send(cmd)
            .map_err(|e| e.to_string())
    }

    pub fn run() {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let tx_http = tx.clone();
        tauri::Builder::default()
            .plugin(tauri_plugin_log::Builder::default().build())
            .manage(CmdTx(Mutex::new(tx)))
            .invoke_handler(tauri::generate_handler![mav_cmd])
            .setup(move |app| {
                let handle = app.handle().clone();
                let on_sample: OnSample = Arc::new(move |s: &Sample| {
                    let _ = handle.emit("sample", s);
                });
                spawn_backend(rx, tx_http, on_sample);
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running ArduLoops");
    }
}

#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
