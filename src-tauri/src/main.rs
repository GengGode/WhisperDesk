#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use whisper_desk_lib::server::AuthConfig;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--headless") {
        let api_port = parse_arg(&args, "--port").unwrap_or(3000);
        let web_port = parse_arg(&args, "--web-port");
        let auth = parse_auth(&args);
        whisper_desk_lib::run_headless(api_port, web_port, auth);
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

fn parse_auth(args: &[String]) -> Option<AuthConfig> {
    let user = args.iter()
        .position(|a| a == "--auth-user")
        .and_then(|i| args.get(i + 1))
        .cloned();
    let pass = args.iter()
        .position(|a| a == "--auth-pass")
        .and_then(|i| args.get(i + 1))
        .cloned();

    match (user, pass) {
        (Some(u), Some(p)) if !u.is_empty() => Some(AuthConfig::new(true, u, p)),
        _ => None,
    }
}
