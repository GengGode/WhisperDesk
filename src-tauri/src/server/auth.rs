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
    /// 密码（明文存储，与用户名组合成 "username:password" 比对）
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

    /// 验证请求中的 Authorization 头
    fn verify(&self, credentials: &str) -> bool {
        if !self.enabled || self.username.is_empty() {
            return true;
        }
        let expected = format!("{}:{}", self.username, self.password);
        // 明文直接比对
        credentials == expected
    }
}

/// 鉴权中间件
///
/// 如果 AuthConfig.enabled 为 true，则检查请求中的 Authorization 头，
/// 要求格式为 "username:password" 的明文。验证失败返回 401 并附带
/// `WWW-Authenticate` 头，浏览器会弹出登录框。
pub async fn auth_middleware(
    State(config): State<AuthConfig>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 未启用鉴权，直接放行
    if !config.enabled {
        return Ok(next.run(req).await);
    }

    // 提取 Authorization 头
    let passed = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|h| config.verify(h))
        .unwrap_or(false);

    if passed {
        Ok(next.run(req).await)
    } else {
        // 返回 401 并提示浏览器弹出登录框
        let mut response = StatusCode::UNAUTHORIZED.into_response();
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            "Basic realm=\"WhisperDesk\"".parse().unwrap(),
        );
        Err(StatusCode::UNAUTHORIZED)
    }
}
