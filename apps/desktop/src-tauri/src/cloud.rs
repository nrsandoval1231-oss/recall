//! Bounded HTTPS transport. The revocable cloud credential stays in the OS store.
use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;
const KEY: &str = "megraph-cloud-session";
const MAX_RESPONSE: u64 = 36 * 1024 * 1024;

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(660)).build()
}
fn origin(value: &str) -> Result<String,String> {
    let url = value.trim_end_matches('/');
    if !url.starts_with("https://") || url.len()>255 || url[8..].contains(['/', '@', '?', '#', '\\']) || url.chars().any(char::is_whitespace) {
        return Err("Enter the HTTPS origin of your MONOLITH server, without a path.".into());
    }
    Ok(url.into())
}
fn response(result: Result<ureq::Response,ureq::Error>, source: bool) -> Result<Value,String> {
    let response = match result { Ok(response)=>response, Err(ureq::Error::Status(_,response))=>response, Err(_)=>return Err("Cloud connection unavailable; local changes are retained.".into()) };
    let status = response.status();
    let hash = response.header("X-Recall-Source-SHA256").unwrap_or("").to_string();
    let mime = response.header("Content-Type").unwrap_or("application/octet-stream").split(';').next().unwrap_or("").to_string();
    let mut bytes = Vec::new();
    response.into_reader().take(MAX_RESPONSE+1).read_to_end(&mut bytes).map_err(|_|"Cloud response interrupted")?;
    if bytes.len() as u64>MAX_RESPONSE {return Err("Cloud response exceeds device limit".into());}
    let body = if source && status == 200 {json!({"bytes":bytes,"sha256":hash,"mime_type":mime})} else {serde_json::from_slice(&bytes).map_err(|_|"Invalid cloud response")?};
    Ok(json!({"status":status,"body":body}))
}
fn cloud_connect_blocking(url: String, enrollment: String) -> Result<Value,String> {
    let url = origin(&url)?;
    if enrollment.len()>150 || !enrollment.starts_with("enr_") {return Err("Use a current one-time owner access code".into());}
    let result = response(agent().post(&format!("{url}/v1/enrollment/redeem")).set("X-Recall-Enrollment","1").send_json(json!({"enrollment_token":enrollment})), false)?;
    if result["status"]!=200 {return Err("Cloud enrollment was refused or expired".into());}
    let token=result["body"]["session_token"].as_str().ok_or("Missing cloud session")?;
    crate::secrets::secret_set(KEY.into(),json!({"url":url,"token":token}).to_string())?;
    Ok(json!({"connected":true,"url":url,"workspace_id":result["body"]["workspace_id"]}))
}
fn cloud_request_blocking(path: String, method: String, body: Option<String>) -> Result<Value,String> {
    if !path.starts_with("/library/") && path!="/settings/ai" {return Err("Unsupported cloud route".into());}
    if path.contains(['#','\\']) || path.contains("..") || path.len()>2048 || !["GET","POST","PUT"].contains(&method.as_str()) {return Err("Invalid cloud request".into());}
    if body.as_ref().is_some_and(|value|value.len()>36*1024*1024) {return Err("Cloud request too large".into());}
    let stored = crate::secrets::secret_get(KEY.into())?.ok_or("Connect this device to MONOLITH first")?;
    let session:Value=serde_json::from_str(&stored).map_err(|_|"Invalid saved cloud session")?;
    let url=origin(session["url"].as_str().ok_or("Missing cloud origin")?)?;
    let token=session["token"].as_str().filter(|v|v.starts_with("rcs_")).ok_or("Invalid saved cloud credential")?;
    let request=agent().request(&method,&format!("{url}/v1{path}")).set("Authorization",&format!("Bearer {token}"));
    response(if let Some(body)=body {request.set("Content-Type","application/json").send_string(&body)} else {request.call()}, path.ends_with("/source"))
}
fn cloud_disconnect_blocking() -> Result<(),String> {
    let stored=crate::secrets::secret_get(KEY.into())?;
    if let Some(stored)=stored {
        let session:Value=serde_json::from_str(&stored).map_err(|_|"Invalid saved cloud session")?;
        let url=origin(session["url"].as_str().ok_or("Missing cloud origin")?)?;
        let token=session["token"].as_str().ok_or("Missing cloud credential")?;
        let result=response(agent().post(&format!("{url}/v1/enrollment/session/revoke")).set("Authorization",&format!("Bearer {token}")).call(),false)?;
        if result["status"]!=200 && result["status"]!=401 {return Err("Session revocation did not finish; retry when online".into());}
    }
    crate::secrets::secret_remove(KEY.into())
}

#[tauri::command]
pub async fn cloud_connect(url: String, enrollment: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || cloud_connect_blocking(url, enrollment)).await.map_err(|_| "Cloud request task failed".to_string())?
}

#[tauri::command]
pub async fn cloud_request(path: String, method: String, body: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || cloud_request_blocking(path, method, body)).await.map_err(|_| "Cloud request task failed".to_string())?
}

#[tauri::command]
pub async fn cloud_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cloud_disconnect_blocking()).await.map_err(|_| "Cloud request task failed".to_string())?
}
