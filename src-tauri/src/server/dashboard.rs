use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const MAX_COMPLETED: usize = 50;

/// 转录配置（由客户端 settings 同步到内存，不独立持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub model_name: String,
    pub threads: u8,
    pub use_gpu: bool,

    #[serde(default = "default_best_of")]
    pub best_of: i32,
    #[serde(default = "default_true")]
    pub suppress_blank: bool,
    #[serde(default = "default_true")]
    pub suppress_nst: bool,
    #[serde(default = "default_true")]
    pub no_context: bool,
    #[serde(default = "default_entropy_thold")]
    pub entropy_thold: f32,
    #[serde(default = "default_logprob_thold")]
    pub logprob_thold: f32,
    #[serde(default = "default_no_speech_thold")]
    pub no_speech_thold: f32,
    #[serde(default)]
    pub temperature: f32,
    #[serde(default = "default_temperature_inc")]
    pub temperature_inc: f32,
    #[serde(default = "default_max_initial_ts")]
    pub max_initial_ts: f32,
    #[serde(default = "default_max_repeat_filter")]
    pub max_repeat_filter: u32,
    #[serde(default = "default_true")]
    pub enable_vad: bool,
    #[serde(default)]
    pub initial_prompt: String,
}

fn default_best_of() -> i32 { 5 }
fn default_true() -> bool { true }
fn default_entropy_thold() -> f32 { 2.4 }
fn default_logprob_thold() -> f32 { -1.0 }
fn default_no_speech_thold() -> f32 { 0.6 }
fn default_temperature_inc() -> f32 { 0.2 }
fn default_max_initial_ts() -> f32 { 1.0 }
fn default_max_repeat_filter() -> u32 { 3 }

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            model_name: "base".to_string(),
            threads: 4,
            use_gpu: true,
            best_of: default_best_of(),
            suppress_blank: true,
            suppress_nst: true,
            no_context: true,
            entropy_thold: default_entropy_thold(),
            logprob_thold: default_logprob_thold(),
            no_speech_thold: default_no_speech_thold(),
            temperature: 0.0,
            temperature_inc: default_temperature_inc(),
            max_initial_ts: default_max_initial_ts(),
            max_repeat_filter: default_max_repeat_filter(),
            enable_vad: true,
            initial_prompt: String::new(),
        }
    }
}

/// 任务状态枚举
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Receiving,
    Transcribing,
    Completed,
    Failed,
}

/// 单个转录任务的跟踪信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: String,
    pub client_ip: String,
    pub file_size: u64,
    pub model_name: String,
    pub status: TaskStatus,
    pub progress: f32,
    pub message: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    /// 转录结果的前 200 个字符
    pub result_summary: Option<String>,
}

/// Dashboard 事件，通过 broadcast 推送给 SSE 订阅者
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardEvent {
    pub event_type: String,
    pub task: TaskInfo,
}

/// Dashboard 快照（JSON API 返回值）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub uptime_seconds: i64,
    pub gpu: bool,
    pub gpu_message: String,
    pub server_config: ServerConfig,
    pub active_tasks: Vec<TaskInfo>,
    pub completed_tasks: Vec<TaskInfo>,
}

/// 服务端 Dashboard 共享状态
pub struct DashboardState {
    active_tasks: Mutex<HashMap<String, TaskInfo>>,
    completed_tasks: Mutex<VecDeque<TaskInfo>>,
    config: Mutex<ServerConfig>,
    started_at: DateTime<Utc>,
    event_tx: broadcast::Sender<DashboardEvent>,
}

impl DashboardState {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(128);
        Self {
            active_tasks: Mutex::new(HashMap::new()),
            completed_tasks: Mutex::new(VecDeque::new()),
            config: Mutex::new(ServerConfig::default()),
            started_at: Utc::now(),
            event_tx,
        }
    }

    pub fn get_config(&self) -> ServerConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn set_config(&self, cfg: ServerConfig) {
        *self.config.lock().unwrap() = cfg;
    }

    /// 注册新任务（收到请求时调用）
    pub fn register_task(&self, id: &str, client_ip: &str, file_size: u64, model_name: &str) {
        let task = TaskInfo {
            id: id.to_string(),
            client_ip: client_ip.to_string(),
            file_size,
            model_name: model_name.to_string(),
            status: TaskStatus::Receiving,
            progress: 0.0,
            message: "正在接收音频文件...".to_string(),
            started_at: Utc::now(),
            completed_at: None,
            result_summary: None,
        };
        self.active_tasks.lock().unwrap().insert(id.to_string(), task.clone());
        self.broadcast(DashboardEvent { event_type: "task_added".into(), task });
    }

    /// 更新任务状态为"转录中"
    pub fn set_transcribing(&self, id: &str) {
        if let Some(task) = self.active_tasks.lock().unwrap().get_mut(id) {
            task.status = TaskStatus::Transcribing;
            task.message = "开始转录...".to_string();
            self.broadcast(DashboardEvent { event_type: "task_updated".into(), task: task.clone() });
        }
    }

    /// 更新转录进度
    pub fn update_progress(&self, id: &str, progress: f32, message: &str) {
        if let Some(task) = self.active_tasks.lock().unwrap().get_mut(id) {
            task.progress = progress;
            task.message = message.to_string();
            self.broadcast(DashboardEvent { event_type: "task_updated".into(), task: task.clone() });
        }
    }

    /// 标记任务完成
    pub fn complete_task(&self, id: &str, result_summary: Option<String>) {
        let task = {
            let mut map = self.active_tasks.lock().unwrap();
            let Some(mut task) = map.remove(id) else { return };
            task.status = TaskStatus::Completed;
            task.progress = 1.0;
            task.message = "转录完成".to_string();
            task.completed_at = Some(Utc::now());
            task.result_summary = result_summary;
            task
        };
        self.push_completed(task.clone());
        self.broadcast(DashboardEvent { event_type: "task_completed".into(), task });
    }

    /// 标记任务失败
    pub fn fail_task(&self, id: &str, error: &str) {
        let task = {
            let mut map = self.active_tasks.lock().unwrap();
            let Some(mut task) = map.remove(id) else { return };
            task.status = TaskStatus::Failed;
            task.message = error.to_string();
            task.completed_at = Some(Utc::now());
            task
        };
        self.push_completed(task.clone());
        self.broadcast(DashboardEvent { event_type: "task_failed".into(), task });
    }

    /// 获取当前快照
    pub fn snapshot(&self) -> DashboardSnapshot {
        let cuda_info = crate::services::cuda::get_cuda_info();
        let active: Vec<TaskInfo> = self.active_tasks.lock().unwrap().values().cloned().collect();
        let completed: Vec<TaskInfo> = self.completed_tasks.lock().unwrap().iter().cloned().collect();
        let uptime = Utc::now().signed_duration_since(self.started_at).num_seconds();

        DashboardSnapshot {
            uptime_seconds: uptime,
            gpu: cuda_info.available,
            gpu_message: cuda_info.message.clone(),
            server_config: self.get_config(),
            active_tasks: active,
            completed_tasks: completed,
        }
    }

    /// 订阅事件流
    pub fn subscribe(&self) -> broadcast::Receiver<DashboardEvent> {
        self.event_tx.subscribe()
    }

    fn push_completed(&self, task: TaskInfo) {
        let mut q = self.completed_tasks.lock().unwrap();
        q.push_front(task);
        while q.len() > MAX_COMPLETED {
            q.pop_back();
        }
    }

    fn broadcast(&self, event: DashboardEvent) {
        let _ = self.event_tx.send(event);
    }
}
