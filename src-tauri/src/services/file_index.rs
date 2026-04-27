use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::audio::{AudioFileMeta, TranscriptionResult, TranscriptionSegment, TranscriptionStatus};
use crate::models::error::AppError;
use crate::services::audio::probe_audio_metadata;
use crate::services::paths;

pub struct FileIndexService {
    db_path: PathBuf,
}

impl FileIndexService {
    pub fn portable() -> Result<Self, AppError> {
        Ok(Self {
            db_path: paths::db_path()?,
        })
    }

    pub fn init(&self) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS audio_files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                format TEXT NOT NULL,
                duration REAL NOT NULL,
                sample_rate INTEGER NOT NULL,
                channels INTEGER NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                transcription_status TEXT NOT NULL
            );",
        )?;

        // 检查是否存在旧版 transcription_results 表（以 audio_file_id 为主键、无 id 列）
        let has_id_col: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('transcription_results') WHERE name = 'id'",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;

        let table_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='transcription_results'",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;

        if table_exists && !has_id_col {
            // 旧表存在且缺少 id 列 → 迁移
            conn.execute_batch(
                "ALTER TABLE transcription_results RENAME TO _old_transcription_results;

                CREATE TABLE transcription_results (
                    id TEXT PRIMARY KEY,
                    audio_file_id TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    text TEXT NOT NULL,
                    segments_json TEXT NOT NULL,
                    language TEXT NOT NULL,
                    duration REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX idx_tr_audio_file ON transcription_results(audio_file_id);

                INSERT INTO transcription_results
                    (id, audio_file_id, model_name, text, segments_json, language, duration, created_at)
                SELECT
                    lower(hex(randomblob(16))),
                    audio_file_id, 'unknown', text, segments_json, language, duration, created_at
                FROM _old_transcription_results;

                DROP TABLE _old_transcription_results;",
            )?;
        } else if !table_exists {
            conn.execute_batch(
                "CREATE TABLE transcription_results (
                    id TEXT PRIMARY KEY,
                    audio_file_id TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    text TEXT NOT NULL,
                    segments_json TEXT NOT NULL,
                    language TEXT NOT NULL,
                    duration REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_tr_audio_file ON transcription_results(audio_file_id);",
            )?;
        }

        // 迁移：添加 starred 列
        let has_starred: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('audio_files') WHERE name = 'starred'",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if !has_starred {
            conn.execute_batch(
                "ALTER TABLE audio_files ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        // 迁移：添加 tags 列（JSON 数组字符串）
        let has_tags: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('audio_files') WHERE name = 'tags'",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if !has_tags {
            conn.execute_batch(
                "ALTER TABLE audio_files ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';",
            )?;
        }

        Ok(())
    }

    pub fn import_audio_file(&self, path: &Path) -> Result<AudioFileMeta, AppError> {
        if !path.exists() {
            return Err(AppError::FileSystem("音频文件不存在".to_string()));
        }

        let meta = probe_audio_metadata(path)?;
        let file_meta = fs::metadata(path)?;
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown")
            .to_lowercase();

        let model = AudioFileMeta {
            id: Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            path: path.to_string_lossy().to_string(),
            format: extension,
            duration: meta.duration_seconds,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u16,
            size: file_meta.len(),
            created_at: Utc::now().to_rfc3339(),
            transcription_status: TranscriptionStatus::Pending,
            starred: false,
            tags: vec![],
        };
        self.upsert_audio(&model)?;
        Ok(model)
    }

    pub fn upsert_audio(&self, file: &AudioFileMeta) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;
        let tags_json = serde_json::to_string(&file.tags)
            .map_err(|e| AppError::Database(format!("序列化标签失败: {e}")))?;
        conn.execute(
            "INSERT INTO audio_files (
                id, name, path, format, duration, sample_rate, channels, size,
                created_at, transcription_status, starred, tags
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                format = excluded.format,
                duration = excluded.duration,
                sample_rate = excluded.sample_rate,
                channels = excluded.channels,
                size = excluded.size,
                transcription_status = excluded.transcription_status",
            params![
                file.id,
                file.name,
                file.path,
                file.format,
                file.duration,
                file.sample_rate,
                file.channels,
                file.size,
                file.created_at,
                status_to_str(&file.transcription_status),
                file.starred as i32,
                tags_json,
            ],
        )?;
        Ok(())
    }

    pub fn list_audio(&self) -> Result<Vec<AudioFileMeta>, AppError> {
        let conn = Connection::open(&self.db_path)?;
        let mut stmt = conn.prepare(
            "SELECT id, name, path, format, duration, sample_rate, channels, size,
                    created_at, transcription_status, starred, tags
             FROM audio_files
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(11)?;
            Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
                row.get(8)?, row.get::<_, String>(9)?,
                row.get::<_, i32>(10)?, tags_json,
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (id, name, path, format, duration, sample_rate, channels, size,
                 created_at, status_str, starred_int, tags_json):
                (String, String, String, String, f64, u32, u16, u64,
                 String, String, i32, String) = row?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            out.push(AudioFileMeta {
                id, name, path, format, duration, sample_rate, channels, size,
                created_at,
                transcription_status: str_to_status(&status_str),
                starred: starred_int != 0,
                tags,
            });
        }
        Ok(out)
    }

    /// 切换收藏状态，返回新状态
    pub fn toggle_star(&self, id: &str) -> Result<bool, AppError> {
        let conn = Connection::open(&self.db_path)?;
        conn.execute(
            "UPDATE audio_files SET starred = CASE WHEN starred = 0 THEN 1 ELSE 0 END WHERE id = ?",
            params![id],
        )?;
        let new_val: i32 = conn.query_row(
            "SELECT starred FROM audio_files WHERE id = ?",
            params![id],
            |row| row.get(0),
        )?;
        Ok(new_val != 0)
    }

    /// 替换文件的全部标签
    pub fn set_tags(&self, id: &str, tags: &[String]) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;
        let tags_json = serde_json::to_string(tags)
            .map_err(|e| AppError::Database(format!("序列化标签失败: {e}")))?;
        conn.execute(
            "UPDATE audio_files SET tags = ? WHERE id = ?",
            params![tags_json, id],
        )?;
        Ok(())
    }

    /// 获取所有使用中的不重复标签
    pub fn list_all_tags(&self) -> Result<Vec<String>, AppError> {
        let conn = Connection::open(&self.db_path)?;
        let mut stmt = conn.prepare("SELECT tags FROM audio_files WHERE tags != '[]'")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut tag_set = std::collections::BTreeSet::new();
        for row in rows {
            let json = row?;
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(&json) {
                for t in tags {
                    tag_set.insert(t);
                }
            }
        }
        Ok(tag_set.into_iter().collect())
    }

    /// 从索引中删除音频文件及其关联的转录结果（不删除磁盘文件）
    pub fn delete_audio(&self, id: &str) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;
        conn.execute(
            "DELETE FROM transcription_results WHERE audio_file_id = ?",
            params![id],
        )?;
        conn.execute("DELETE FROM audio_files WHERE id = ?", params![id])?;
        Ok(())
    }

    /// 保存转录结果（每次转录追加一条新记录）
    pub fn save_transcription_result(&self, result: &TranscriptionResult) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;
        let segments_json = serde_json::to_string(&result.segments)
            .map_err(|e| AppError::Database(format!("序列化分段失败: {e}")))?;

        conn.execute(
            "INSERT INTO transcription_results (id, audio_file_id, model_name, text, segments_json, language, duration, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                result.id,
                result.audio_file_id,
                result.model_name,
                result.text,
                segments_json,
                result.language,
                result.duration,
                result.created_at,
            ],
        )?;

        conn.execute(
            "UPDATE audio_files SET transcription_status = ? WHERE id = ?",
            params![status_to_str(&TranscriptionStatus::Completed), result.audio_file_id],
        )?;
        Ok(())
    }

    /// 更新已有转录结果（编辑器保存时通过 result id 定位）
    pub fn update_transcription(
        &self,
        id: &str,
        text: &str,
        segments: &[TranscriptionSegment],
    ) -> Result<(), AppError> {
        let conn = Connection::open(&self.db_path)?;
        let segments_json = serde_json::to_string(segments)
            .map_err(|e| AppError::Database(format!("序列化分段失败: {e}")))?;

        let affected = conn.execute(
            "UPDATE transcription_results SET text = ?, segments_json = ? WHERE id = ?",
            params![text, segments_json, id],
        )?;

        if affected == 0 {
            return Err(AppError::InvalidArgument(
                "未找到对应的转录结果".to_string(),
            ));
        }
        Ok(())
    }

    /// 获取某音频文件的全部转录结果（按创建时间倒序）
    pub fn get_transcription_results(&self, audio_file_id: &str) -> Result<Vec<TranscriptionResult>, AppError> {
        let conn = Connection::open(&self.db_path)?;
        let mut stmt = conn.prepare(
            "SELECT id, audio_file_id, model_name, text, segments_json, language, duration, created_at
             FROM transcription_results
             WHERE audio_file_id = ?
             ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map(params![audio_file_id], |row| {
            let segments_json: String = row.get(4)?;
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, segments_json, row.get(5)?, row.get(6)?, row.get(7)?))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (id, audio_file_id, model_name, text, segments_json, language, duration, created_at):
                (String, String, String, String, String, String, f64, String) = row?;
            let segments: Vec<TranscriptionSegment> = serde_json::from_str(&segments_json)
                .map_err(|e| AppError::Database(format!("反序列化分段失败: {e}")))?;
            out.push(TranscriptionResult { id, audio_file_id, model_name, text, segments, language, duration, created_at });
        }
        Ok(out)
    }

    /// 通过 result id 获取单条转录结果（导出用）
    pub fn get_transcription_result_by_id(&self, id: &str) -> Result<Option<TranscriptionResult>, AppError> {
        let conn = Connection::open(&self.db_path)?;
        let mut stmt = conn.prepare(
            "SELECT id, audio_file_id, model_name, text, segments_json, language, duration, created_at
             FROM transcription_results WHERE id = ?",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let segments_json: String = row.get(4)?;
            let segments: Vec<TranscriptionSegment> = serde_json::from_str(&segments_json)
                .map_err(|e| AppError::Database(format!("反序列化分段失败: {e}")))?;
            return Ok(Some(TranscriptionResult {
                id: row.get(0)?,
                audio_file_id: row.get(1)?,
                model_name: row.get(2)?,
                text: row.get(3)?,
                segments,
                language: row.get(5)?,
                duration: row.get(6)?,
                created_at: row.get(7)?,
            }));
        }
        Ok(None)
    }
}

fn status_to_str(status: &TranscriptionStatus) -> &'static str {
    match status {
        TranscriptionStatus::Pending => "pending",
        TranscriptionStatus::Transcribing => "transcribing",
        TranscriptionStatus::Completed => "completed",
        TranscriptionStatus::Failed => "failed",
    }
}

fn str_to_status(value: &str) -> TranscriptionStatus {
    match value {
        "transcribing" => TranscriptionStatus::Transcribing,
        "completed" => TranscriptionStatus::Completed,
        "failed" => TranscriptionStatus::Failed,
        _ => TranscriptionStatus::Pending,
    }
}
