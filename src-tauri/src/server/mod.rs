pub mod dashboard;
pub mod routes;

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::task::JoinHandle;

use serde::Serialize;

pub use dashboard::{DashboardSnapshot, DashboardState};

/// 推理服务运行时状态，由 Tauri manage() 或 headless 模式持有
pub struct InferenceServerState {
    handle: Mutex<Option<JoinHandle<()>>>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    port: AtomicU16,
    dashboard: Arc<DashboardState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
}

impl InferenceServerState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            port: AtomicU16::new(0),
            dashboard: Arc::new(DashboardState::new()),
        }
    }

    pub fn status(&self) -> ServerStatus {
        let port = self.port.load(Ordering::Relaxed);
        ServerStatus {
            running: port != 0,
            port,
        }
    }

    /// 获取 Dashboard 快照（供 Tauri Command 使用）
    pub fn dashboard_snapshot(&self) -> DashboardSnapshot {
        self.dashboard.snapshot()
    }

    pub async fn start(&self, port: u16) -> Result<(), String> {
        let mut handle_guard = self.handle.lock().await;
        if handle_guard.is_some() {
            return Err("推理服务已在运行中".to_string());
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let addr = format!("0.0.0.0:{port}");
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("绑定端口 {port} 失败: {e}"))?;

        let dash = self.dashboard.clone();
        let router = routes::create_router(dash);

        let svc = router.into_make_service_with_connect_info::<std::net::SocketAddr>();
        let handle = tokio::spawn(async move {
            axum::serve(listener, svc)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        *handle_guard = Some(handle);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);
        self.port.store(port, Ordering::Relaxed);

        println!("[推理服务] 已启动，监听 0.0.0.0:{port}");
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.lock().await.take() {
            let _ = handle.await;
        }
        self.port.store(0, Ordering::Relaxed);
        println!("[推理服务] 已停止");
        Ok(())
    }
}
