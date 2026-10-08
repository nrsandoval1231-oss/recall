//! Native-only existing connection reader and bounded selected-photo HTTP transport.
use crate::reading::{ReadingReceipt, ReadingRequest, MAX_RESPONSE};
use serde::Deserialize;
use std::{io::Read, time::Duration};
type Result<T> = std::result::Result<T, String>;
// Deliberately unreachable through legacy renderer secret_get/set/remove.
const PROTECTED_SERVICE: &str = "app.recall.desktop.selected-photo-reading";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[derive(Clone)]
pub struct ProtectedConnection {
    schema_version: String,
    vault_id: String,
    origin: String,
    credential: String,
}
impl ProtectedConnection {
    fn parse(raw: &str, vault_id: &str) -> Result<Self> {
        if raw.len() > 8192 {
            return Err("Photo reading connection is unavailable".into());
        }
        let c: Self =
            serde_json::from_str(raw).map_err(|_| "Photo reading connection is unavailable")?;
        let url = reqwest::Url::parse(&c.origin)
            .map_err(|_| "Photo reading connection is unavailable")?;
        if c.schema_version != "1.0"
            || c.vault_id != vault_id
            || uuid::Uuid::parse_str(vault_id).is_err()
            || url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || c.credential.is_empty()
            || c.credential.len() > 4096
            || !c.credential.bytes().all(|b| (33..=126).contains(&b))
        {
            return Err("Photo reading connection is unavailable".into());
        }
        Ok(c)
    }
    pub fn fingerprint(&self) -> String {
        // A non-secret digest binds retries to the exact existing device connection.
        // Neither bearer credential nor origin is written into the portable intent.
        let origin = reqwest::Url::parse(&self.origin)
            .expect("validated connection URL")
            .origin()
            .ascii_serialization();
        crate::reading::sha(
            &serde_json::to_vec(&(
                "recall-reading-connection-v1",
                &self.vault_id,
                origin,
                &self.credential,
            ))
            .expect("string tuple serialization"),
        )
    }
    #[cfg(test)]
    pub(crate) fn test_connection(origin: &str, vault: &str, credential: &str) -> Self {
        let url = reqwest::Url::parse(origin).unwrap();
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        Self {
            schema_version: "1.0".into(),
            vault_id: vault.into(),
            origin: origin.into(),
            credential: credential.into(),
        }
    }
    pub fn read(vault_id: &str) -> Result<Option<Self>> {
        let entry = keyring::Entry::new(PROTECTED_SERVICE, vault_id)
            .map_err(|_| "Photo reading is not connected")?;
        match entry.get_password() {
            Ok(raw) => Self::parse(&raw, vault_id).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Photo reading is not connected".into()),
        }
    }
}
pub enum ServiceResponse {
    Receipt(ReadingReceipt),
    NotFound,
}
#[cfg(test)]
impl ServiceResponse {
    fn receipt(self) -> ReadingReceipt {
        match self {
            Self::Receipt(r) => r,
            Self::NotFound => panic!("unexpected not found"),
        }
    }
}
pub struct ReadingTransport {
    client: reqwest::blocking::Client,
    connection: ProtectedConnection,
}
impl ReadingTransport {
    pub fn new(connection: ProtectedConnection) -> Result<Self> {
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "Photo reading transport unavailable")?;
        Ok(Self { client, connection })
    }
    pub fn send(
        &self,
        request: &ReadingRequest,
        bytes: Option<Vec<u8>>,
    ) -> Result<ServiceResponse> {
        request.validate()?;
        if request.binding.vault_id != self.connection.vault_id {
            return Err("Photo reading connection scope changed".into());
        }
        let recovery = bytes.is_none();
        let origin = self.connection.origin.trim_end_matches('/');
        let builder = if let Some(bytes) = bytes {
            if bytes.len() > 25 * 1024 * 1024 {
                return Err("Photo exceeds reading limit".into());
            }
            let envelope =
                serde_json::to_string(&request.binding).map_err(|_| "Invalid reading request")?;
            if envelope.len() > 4096 {
                return Err("Reading envelope exceeds limit".into());
            }
            self.client
                .post(format!("{origin}/v1/local-readings"))
                .header("Content-Type", &request.media_type)
                .header("X-Recall-Reading", envelope)
                .body(bytes)
        } else {
            self.client.get(format!(
                "{origin}/v1/local-readings/{}",
                request.binding.operation_id
            ))
        };
        let response = builder
            .bearer_auth(&self.connection.credential)
            .send()
            .map_err(|_| {
                "Reading response unavailable; recover the same operation. Provider cost may apply."
            })?;
        let status = response.status().as_u16();
        if status == 404 && recovery {
            return Ok(ServiceResponse::NotFound);
        }
        if ![200, 202].contains(&status) {
            return Err(match status {
                403 => "Photo reading is not connected or no longer authorized",
                404 => "Reading receipt not found; no new upload was made",
                409 => "Photo reading is unavailable for this operation",
                _ => "Photo reading service rejected the request",
            }
            .into());
        }
        if response
            .content_length()
            .is_some_and(|len| len >= MAX_RESPONSE)
        {
            return Err("Reading response exceeds limit".into());
        }
        let mut body = Vec::new();
        response
            .take(MAX_RESPONSE)
            .read_to_end(&mut body)
            .map_err(|_| "Reading response interrupted; recover the same operation")?;
        if body.len() as u64 >= MAX_RESPONSE {
            return Err("Reading response exceeds limit".into());
        }
        let receipt: ReadingReceipt =
            serde_json::from_slice(&body).map_err(|_| "Invalid reading response")?;
        receipt.validate(request)?;
        if (status == 202) != matches!(receipt.state.as_str(), "in_flight" | "unknown") {
            return Err("Reading response status mismatch".into());
        }
        Ok(ServiceResponse::Receipt(receipt))
    }
    #[cfg(test)]
    pub(crate) fn test_from_connection(connection: ProtectedConnection) -> Result<Self> {
        let url = reqwest::Url::parse(&connection.origin).map_err(|_| "Invalid loopback")?;
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return Err("Test transport only permits loopback".into());
        }
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| "Test client")?;
        Ok(Self { client, connection })
    }
    #[cfg(test)]
    fn test_loopback(origin: &str, timeout: Duration) -> Result<Self> {
        let url = reqwest::Url::parse(origin).map_err(|_| "Invalid loopback")?;
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return Err("Test transport only permits loopback".into());
        }
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()
            .map_err(|_| "Test client")?;
        Ok(Self {
            client,
            connection: ProtectedConnection {
                schema_version: "1.0".into(),
                vault_id: "22222222-2222-4222-8222-222222222222".into(),
                origin: origin.into(),
                credential: "synthetic-credential".into(),
            },
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };
    fn request() -> ReadingRequest {
        let f: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
        ))
        .unwrap();
        serde_json::from_value(serde_json::json!({"binding":f["request"]["binding"],"media_type":f["request"]["media_type"]})).unwrap()
    }
    fn server(status: u16, body: String, delay: Duration) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = socket.read(&mut chunk).unwrap();
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]);
                    let size = head
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            thread::sleep(delay);
            let response=format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/forbidden\r\nConnection: close\r\n\r\n{body}",body.len());
            let _ = socket.write_all(response.as_bytes());
            String::from_utf8(bytes).unwrap()
        });
        (format!("http://{addr}"), handle)
    }
    #[test]
    fn reading_transport_actual_http_auth_binding_bytes_and_recovery() {
        let req = request();
        let body = serde_json::to_string(&ReadingReceipt {
            schema_version: "1.0".into(),
            binding: req.binding.clone(),
            state: "in_flight".into(),
            result: None,
            error_code: None,
        })
        .unwrap();
        for post in [true, false] {
            let (origin, server) = server(202, body.clone(), Duration::ZERO);
            let transport =
                ReadingTransport::test_loopback(&origin, Duration::from_secs(2)).unwrap();
            let result = transport
                .send(
                    &req,
                    if post {
                        Some(b"SYNTHETIC-BODY".to_vec())
                    } else {
                        None
                    },
                )
                .unwrap()
                .receipt();
            assert_eq!(result.state, "in_flight");
            let wire = server.join().unwrap();
            assert!(wire
                .to_lowercase()
                .contains("authorization: bearer synthetic-credential\r\n"));
            if post {
                assert!(wire.starts_with("POST /v1/local-readings "));
                assert!(wire.to_lowercase().contains("x-recall-reading: "));
                assert!(wire.ends_with("SYNTHETIC-BODY"));
            } else {
                assert!(wire.starts_with(&format!(
                    "GET /v1/local-readings/{} ",
                    req.binding.operation_id
                )));
                assert!(!wire.contains("SYNTHETIC-BODY"));
            }
        }
    }
    #[test]
    fn reading_transport_rejects_redirect_bad_body_oversize_and_timeout() {
        for (status, body, delay) in [
            (302, "{}".into(), Duration::ZERO),
            (200, "{".into(), Duration::ZERO),
            (200, "x".repeat(MAX_RESPONSE as usize + 1), Duration::ZERO),
            (200, "{}".into(), Duration::from_millis(250)),
        ] {
            let (origin, server) = server(status, body, delay);
            let transport =
                ReadingTransport::test_loopback(&origin, Duration::from_millis(80)).unwrap();
            assert!(transport.send(&request(), None).is_err());
            server.join().unwrap();
        }
    }
    #[test]
    fn reading_connection_is_native_only_scoped_and_https_origin_only() {
        let vault = request().binding.vault_id;
        for origin in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/path",
            "https://example.com/?query=x",
            "https://example.com/#fragment",
        ] {
            let raw=serde_json::json!({"schema_version":"1.0","vault_id":vault,"origin":origin,"credential":"synthetic"}).to_string();
            assert!(
                ProtectedConnection::parse(&raw, &vault).is_err(),
                "{origin}"
            );
        }
        let raw=serde_json::json!({"schema_version":"1.0","vault_id":vault,"origin":"https://recall.example","credential":"synthetic"}).to_string();
        assert!(ProtectedConnection::parse(&raw, &vault).is_ok());
        assert!(ProtectedConnection::parse(&raw, &request().binding.memory_id).is_err());
        assert_ne!(PROTECTED_SERVICE, "app.recall.desktop.session");
    }
}

#[cfg(test)]
mod boundary_tests {
    use super::*;
    #[test]
    fn reading_unconfigured_connection_is_disabled_without_creating_credentials() {
        assert!(ProtectedConnection::read(&uuid::Uuid::new_v4().to_string())
            .ok()
            .flatten()
            .is_none());
    }
    #[test]
    fn reading_redirect_never_contacts_the_destination() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let destination = target.local_addr().unwrap();
        let responder = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut b = [0u8; 4096];
            stream.read(&mut b).unwrap();
            stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{destination}/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
        });
        let f: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/local-reading-synthetic.json"
        ))
        .unwrap();
        let request:ReadingRequest=serde_json::from_value(serde_json::json!({"binding":f["request"]["binding"],"media_type":f["request"]["media_type"]})).unwrap();
        let transport =
            ReadingTransport::test_loopback(&origin, Duration::from_millis(150)).unwrap();
        assert!(transport.send(&request, None).is_err());
        responder.join().unwrap();
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}
