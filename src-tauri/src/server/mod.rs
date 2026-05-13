pub mod dashboard;
pub mod routes;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::task::JoinHandle;

use serde::Serialize;

pub use dashboard::{DashboardSnapshot, DashboardState, ServerConfig};

/// 推理服务 + Web 前端 运行时状态
pub struct InferenceServerState {
    // 后台 API 服务
    handle: Mutex<Option<JoinHandle<()>>>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    port: AtomicU16,
    dashboard: Arc<DashboardState>,
    // Web 前端服务
    web_handle: Mutex<Option<JoinHandle<()>>>,
    web_shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    web_port: AtomicU16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub web_running: bool,
    pub web_port: u16,
}

impl InferenceServerState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            port: AtomicU16::new(0),
            dashboard: Arc::new(DashboardState::new()),
            web_handle: Mutex::new(None),
            web_shutdown_tx: Mutex::new(None),
            web_port: AtomicU16::new(0),
        }
    }

    pub fn status(&self) -> ServerStatus {
        let port = self.port.load(Ordering::Relaxed);
        let web_port = self.web_port.load(Ordering::Relaxed);
        ServerStatus {
            running: port != 0,
            port,
            web_running: web_port != 0,
            web_port,
        }
    }

    pub fn dashboard_snapshot(&self) -> DashboardSnapshot {
        self.dashboard.snapshot()
    }

    pub fn set_server_config(&self, cfg: ServerConfig) {
        self.dashboard.set_config(cfg);
    }

    // ── 后台 API 服务 ──

    /// 启动后台 API 服务（推理 + 文件管理 + Dashboard）
    pub async fn start_api(&self, port: u16) -> Result<(), String> {
        let mut handle_guard = self.handle.lock().await;
        if handle_guard.is_some() {
            return Err("后台 API 服务已在运行中".to_string());
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let addr = format!("0.0.0.0:{port}");
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("绑定 API 端口 {port} 失败: {e}"))?;

        let dash = self.dashboard.clone();
        let router = routes::create_router(dash);
        let svc = router.into_make_service_with_connect_info::<std::net::SocketAddr>();

        let handle = tokio::spawn(async move {
            axum::serve(listener, svc)
                .with_graceful_shutdown(async { let _ = shutdown_rx.await; })
                .await
                .ok();
        });

        *handle_guard = Some(handle);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);
        self.port.store(port, Ordering::Relaxed);
        println!("[API 服务] 已启动，监听 0.0.0.0:{port}");
        Ok(())
    }

    pub async fn stop_api(&self) -> Result<(), String> {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.lock().await.take() {
            let _ = handle.await;
        }
        self.port.store(0, Ordering::Relaxed);
        println!("[API 服务] 已停止");
        Ok(())
    }

    // ── Web 前端服务 ──

    /// 启动 Web 前端服务（SPA 静态文件 + 注入 API 端口）
    pub async fn start_web(&self, web_port: u16, web_dir: PathBuf, api_port: u16) -> Result<(), String> {
        let mut handle_guard = self.web_handle.lock().await;
        if handle_guard.is_some() {
            return Err("Web 前端服务已在运行中".to_string());
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let addr = format!("0.0.0.0:{web_port}");
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("绑定 Web 端口 {web_port} 失败: {e}"))?;

        let router = routes::create_web_router(web_dir, api_port);
        let svc = router.into_make_service();

        let handle = tokio::spawn(async move {
            axum::serve(listener, svc)
                .with_graceful_shutdown(async { let _ = shutdown_rx.await; })
                .await
                .ok();
        });

        *handle_guard = Some(handle);
        *self.web_shutdown_tx.lock().await = Some(shutdown_tx);
        self.web_port.store(web_port, Ordering::Relaxed);
        println!("[Web 服务] 已启动，监听 0.0.0.0:{web_port}，API → :{api_port}");
        Ok(())
    }

    pub async fn stop_web(&self) -> Result<(), String> {
        if let Some(tx) = self.web_shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.web_handle.lock().await.take() {
            let _ = handle.await;
        }
        self.web_port.store(0, Ordering::Relaxed);
        println!("[Web 服务] 已停止");
        Ok(())
    }

    // ── 便捷：同时启停 ──

    pub async fn stop(&self) -> Result<(), String> {
        self.stop_web().await.ok();
        self.stop_api().await
    }
}
