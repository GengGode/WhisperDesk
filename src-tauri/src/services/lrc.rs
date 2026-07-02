use std::path::Path;

use crate::models::audio::TranscriptionSegment;
use crate::models::error::AppError;

/// LRC 文件解析结果
pub struct LrcParseResult {
    pub segments: Vec<TranscriptionSegment>,
    /// 元数据中的 offset（毫秒），正值表示歌词提前
    pub offset_ms: i64,
}

/// 读取 LRC 文件并解析为带时间轴的分段列表
///
/// 支持 UTF-8（含 BOM）和 GBK 编码自动检测。
/// 时间标签支持 `[mm:ss.xx]`、`[mm:ss.xxx]`、`[mm:ss]` 三种格式。
pub fn parse_lrc_file(path: &Path, audio_duration: f64) -> Result<LrcParseResult, AppError> {
    let raw_bytes = std::fs::read(path)?;
    let content = decode_text(&raw_bytes);
    parse_lrc_content(&content, audio_duration)
}

/// 自动探测编码并解码为 String
fn decode_text(bytes: &[u8]) -> String {
    // UTF-8 BOM
    let data = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };

    // 尝试 UTF-8
    if let Ok(s) = std::str::from_utf8(data) {
        return s.to_string();
    }

    // 回退到 GBK（中文 LRC 文件最常见的非 UTF-8 编码）
    let (decoded, _, _) = encoding_rs::GBK.decode(data);
    decoded.into_owned()
}

/// 解析 LRC 文本内容
fn parse_lrc_content(content: &str, audio_duration: f64) -> Result<LrcParseResult, AppError> {
    let mut timed_lines: Vec<(f64, String)> = Vec::new();
    let mut offset_ms: i64 = 0;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 提取 [offset:±N] 元数据
        if let Some(val) = extract_meta_value(line, "offset") {
            if let Ok(ms) = val.parse::<i64>() {
                offset_ms = ms;
            }
            continue;
        }

        // 跳过其他元数据标签 [ti:...] [ar:...] [al:...] 等
        if is_meta_tag(line) {
            continue;
        }

        // 提取时间标签和歌词文本
        // 支持一行多个时间标签：[00:01.00][00:15.00]歌词文本
        let (times, text) = extract_time_tags(line);
        if times.is_empty() || text.is_empty() {
            continue;
        }

        for t in times {
            timed_lines.push((t, text.clone()));
        }
    }

    // 按时间排序
    timed_lines.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    // 应用 offset 并转换为 segments
    let offset_sec = offset_ms as f64 / 1000.0;
    let segments: Vec<TranscriptionSegment> = timed_lines
        .iter()
        .enumerate()
        .map(|(i, (start, text))| {
            let adjusted_start = (*start - offset_sec).max(0.0);
            let end = if i + 1 < timed_lines.len() {
                (timed_lines[i + 1].0 - offset_sec).max(adjusted_start)
            } else {
                audio_duration.max(adjusted_start + 5.0)
            };
            TranscriptionSegment {
                start: adjusted_start,
                end,
                text: text.clone(),
            }
        })
        .collect();

    if segments.is_empty() {
        return Err(AppError::InvalidArgument(
            "LRC 文件中未找到有效的歌词行".to_string(),
        ));
    }

    Ok(LrcParseResult {
        segments,
        offset_ms,
    })
}

/// 检查是否为元数据标签行（[ti:...]、[ar:...] 等）
fn is_meta_tag(line: &str) -> bool {
    let meta_prefixes = ["[ti:", "[ar:", "[al:", "[by:", "[re:", "[ve:", "[id:"];
    let lower = line.to_lowercase();
    meta_prefixes.iter().any(|p| lower.starts_with(p))
}

/// 从元数据行提取值，如 `[offset:+500]` → Some("+500")
fn extract_meta_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("[{}:", key);
    let lower = line.to_lowercase();
    if !lower.starts_with(&prefix) {
        return None;
    }
    let start = prefix.len();
    let end = line.find(']').unwrap_or(line.len());
    Some(line[start..end].trim())
}

/// 从一行中提取所有时间标签及歌词文本
///
/// 输入: `[00:12.34][00:24.56]歌词文本`
/// 输出: (vec![12.34, 24.56], "歌词文本")
fn extract_time_tags(line: &str) -> (Vec<f64>, String) {
    let mut times = Vec::new();
    let mut pos = 0;
    let bytes = line.as_bytes();

    while pos < bytes.len() {
        if bytes[pos] != b'[' {
            break;
        }
        let close = match line[pos..].find(']') {
            Some(i) => pos + i,
            None => break,
        };

        let tag_content = &line[pos + 1..close];
        if let Some(t) = parse_time_tag(tag_content) {
            times.push(t);
            pos = close + 1;
        } else {
            break;
        }
    }

    let text = line[pos..].trim().to_string();
    (times, text)
}

/// 解析时间标签内容 `mm:ss.xx` / `mm:ss.xxx` / `mm:ss`
fn parse_time_tag(tag: &str) -> Option<f64> {
    let parts: Vec<&str> = tag.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let minutes: f64 = parts[0].parse().ok()?;
    let seconds: f64 = parts[1].parse().ok()?;

    Some(minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time_tag() {
        assert_eq!(parse_time_tag("01:23.45"), Some(83.45));
        assert_eq!(parse_time_tag("00:00.00"), Some(0.0));
        assert_eq!(parse_time_tag("02:30"), Some(150.0));
        assert_eq!(parse_time_tag("invalid"), None);
    }

    #[test]
    fn test_parse_lrc_content() {
        let content = "\
[ti:Test Song]
[ar:Test Artist]
[offset:0]

[00:05.00]第一行歌词
[00:10.50]第二行歌词
[00:15.00]第三行歌词
";
        let result = parse_lrc_content(content, 60.0).unwrap();
        assert_eq!(result.segments.len(), 3);
        assert_eq!(result.segments[0].text, "第一行歌词");
        assert!((result.segments[0].start - 5.0).abs() < 0.01);
        assert!((result.segments[0].end - 10.5).abs() < 0.01);
    }

    #[test]
    fn test_multi_time_tags() {
        let content = "[00:05.00][00:30.00]重复歌词\n[00:10.00]其他歌词\n";
        let result = parse_lrc_content(content, 60.0).unwrap();
        assert_eq!(result.segments.len(), 3);
    }
}
