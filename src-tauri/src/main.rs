#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "desktop")]
    arduloops_lib::run();
    #[cfg(not(feature = "desktop"))]
    {
        eprintln!("ArduLoops desktop needs --features desktop");
        std::process::exit(1);
    }
}
