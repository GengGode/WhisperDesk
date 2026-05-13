#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--headless") {
        let api_port = parse_arg(&args, "--port").unwrap_or(3000);
        let web_port = parse_arg(&args, "--web-port");
        whisper_desk_lib::run_headless(api_port, web_port);
    } else {
        whisper_desk_lib::run();
    }
}

fn parse_arg(args: &[String], flag: &str) -> Option<u16> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}
