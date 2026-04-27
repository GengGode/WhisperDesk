#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--headless") {
        let port = parse_port(&args).unwrap_or(3000);
        whisper_desk_lib::run_headless(port);
    } else {
        whisper_desk_lib::run();
    }
}

fn parse_port(args: &[String]) -> Option<u16> {
    args.iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}
