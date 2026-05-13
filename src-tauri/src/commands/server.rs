use tauri::State;

use crate::server::{DashboardSnapshot, InferenceServerState, ServerConfig, ServerStatus};

/// 启动后台 API 服务
#[tauri::command]
pub async fn start_api_server(
    state: State<'_, InferenceServerState>,
    port: u16,
) -> Result<(), String> {
    state.start_api(port).await
}

/// 停止后台 API 服务
#[tauri::command]
pub async fn stop_api_server(
    state: State<'_, InferenceServerState>,
) -> Result<(), String> {
    state.stop_api().await
}

/// 启动 Web 前端服务（从编译时嵌入的 SPA 资源提供）
#[tauri::command]
pub async fn start_web_server(
    state: State<'_, InferenceServerState>,
    web_port: u16,
    api_port: u16,
) -> Result<(), String> {
    state.start_web(web_port, api_port).await
}

/// 停止 Web 前端服务
#[tauri::command]
pub async fn stop_web_server(
    state: State<'_, InferenceServerState>,
) -> Result<(), String> {
    state.stop_web().await
}

/// 同时停止所有服务
#[tauri::command]
pub async fn stop_all_servers(
    state: State<'_, InferenceServerState>,
) -> Result<(), String> {
    state.stop().await
}

#[tauri::command]
pub fn get_inference_server_status(
    state: State<'_, InferenceServerState>,
) -> ServerStatus {
    state.status()
}

#[tauri::command]
pub fn get_dashboard_status(
    state: State<'_, InferenceServerState>,
) -> DashboardSnapshot {
    state.dashboard_snapshot()
}

#[tauri::command]
pub fn set_server_config(
    state: State<'_, InferenceServerState>,
    config: ServerConfig,
) {
    state.set_server_config(config);
}
