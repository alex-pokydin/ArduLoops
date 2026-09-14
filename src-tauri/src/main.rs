#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if arduloops_lib::wants_mcp(&args) {
        std::process::exit(arduloops_lib::run_cli(&["mcp".into()]));
    }
    #[cfg(feature = "desktop")]
    arduloops_lib::run();
    #[cfg(not(feature = "desktop"))]
    {
        eprintln!("ArduLoops desktop needs --features desktop");
        std::process::exit(1);
    }
}
