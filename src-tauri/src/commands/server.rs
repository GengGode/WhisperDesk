use tauri::State;

use crate::server::{DashboardSnapshot, InferenceServerState, ServerConfig, ServerStatus};

#[tauri::command]
pub async fn start_inference_server(
    state: State<'_, InferenceServerState>,
    port: u16,
) -> Result<(), String> {
    state.start(port).await
}

#[tauri::command]
pub async fn stop_inference_server(
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
