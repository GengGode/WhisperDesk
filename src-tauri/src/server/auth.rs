use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Web 服务鉴权配置
#[derive(Clone)]
pub struct AuthConfig {
    /// 是否启用鉴权，false 则所有请求直接放行
    pub enabled: bool,
    /// 用户名（空字符串表示不校验）
    pub username: String,
    /// 密码（明文存储）
    pub password: String,
}

impl AuthConfig {
    pub fn new_disabled() -> Self {
        Self {
            enabled: false,
            username: String::new(),
            password: String::new(),
        }
    }

    pub fn new(enabled: bool, username: String, password: String) -> Self {
        Self {
            enabled,
            username,
            password,
        }
    }

    /// 验证 Authorization 头
    ///
    /// 支持两种格式：
    /// 1. 标准 Basic Auth：`Basic base64(username:password)`（浏览器弹窗）
    /// 2. 明文格式：`username:password`（程序调用简便用法）
    fn verify(&self, auth_header: &str) -> bool {
        if !self.enabled || self.username.is_empty() {
            return true;
        }

        let expected = format!("{}:{}", self.username, self.password);

        // 标准 Basic Auth：Basic base64(user:pass)
        if let Some(b64) = auth_header.strip_prefix("Basic ") {
            if let Some(decoded) = base64_decode(b64.trim()) {
                return decoded == expected;
            }
        }

        // 明文回退
        auth_header == expected
    }
}

/// 简易 base64 解码（不引入额外 crate）
fn base64_decode(input: &str) -> Option<String> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;

    while i + 3 < bytes.len() {
        let v0 = val(bytes[i])?;
        let v1 = val(bytes[i + 1])?;
        result.push((v0 << 2) | (v1 >> 4));

        if bytes[i + 2] != b'=' {
            let v2 = val(bytes[i + 2])?;
            result.push(((v1 & 0x0f) << 4) | (v2 >> 2));
        }

        if i + 3 < bytes.len() && bytes[i + 3] != b'=' {
            // 此时 bytes[i+2] 不可能是 '='（否则输入格式非法），v2 已解码
            let v2 = val(bytes[i + 2])?;
            let v3 = val(bytes[i + 3])?;
            result.push(((v2 & 0x03) << 6) | v3);
        }

        i += 4;
    }

    String::from_utf8(result).ok()
}

/// 构造 401 响应（带 WWW-Authenticate 头，浏览器弹出登录框）
fn unauth_response() -> Response {
    let mut resp = StatusCode::UNAUTHORIZED.into_response();
    resp.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        "Basic realm=\"WhisperDesk\", charset=\"UTF-8\""
            .parse()
            .unwrap(),
    );
    resp
}

/// 鉴权中间件
pub async fn auth_middleware(
    State(config): State<AuthConfig>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if !config.enabled {
        return Ok(next.run(req).await);
    }

    let passed = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|h| config.verify(h))
        .unwrap_or(false);

    if passed {
        Ok(next.run(req).await)
    } else {
        Err(unauth_response())
    }
}
