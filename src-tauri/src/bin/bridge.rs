fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    arduloops_lib::migrate_force(args.iter().any(|arg| arg == "--migrate-force"));
    let args: Vec<String> = args.into_iter().filter(|arg| arg != "--migrate-force").collect();
    if args.first().map(String::as_str) == Some("--firmware-worker") {
        std::process::exit(arduloops_lib::run_cli(&args));
    }
    if !args.is_empty() {
        std::process::exit(arduloops_lib::run_cli(&args));
    }
    arduloops_lib::run_bridge();
}
