fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        std::process::exit(arduloops_lib::run_cli(&args));
    }
    arduloops_lib::run_bridge();
}
