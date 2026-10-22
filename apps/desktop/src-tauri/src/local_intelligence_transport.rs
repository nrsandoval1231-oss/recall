//! Fixed-origin native transport for the bounded local-vault Ask contract.
use crate::{
    local_intelligence::{
        strict_json_from_slice, AskCapabilityReply, AskReceipt, AskRequest, HistoryCapabilityReply,
        HistoryConsentRequest, HistoryRequest,
    },
    pairing::IntelligenceConnection,
};
use reqwest::{
    blocking::{Client, Response},
    redirect::Policy,
    Url,
};
use std::{io::Read, time::Duration};

#[cfg(test)]
use std::sync::{Arc, Mutex, OnceLock};

type Result<T> = std::result::Result<T, String>;
const MAX_RESPONSE: u64 = 64 * 1024;

pub enum ReceiptLookup {
    Receipt(AskReceipt),
    NotFound,
}

pub struct LocalIntelligenceTransport {
    client: Client,
    connection: IntelligenceConnection,
}

/// Test-only interruption point immediately before the historical POST is put on
/// the wire.  The production dispatcher still owns every authorization and
/// vault recheck; this only lets its ordering be exercised without a provider.
#[cfg(test)]
static HISTORY_POST_HOOK: OnceLock<Mutex<Option<Arc<dyn Fn() + Send + Sync>>>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn set_history_post_hook(hook: Option<Arc<dyn Fn() + Send + Sync>>) {
    *HISTORY_POST_HOOK
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("history post hook lock") = hook;
}

fn origin(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "Ask service is unavailable")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Ask service is unavailable".into());
    }
    Ok(url)
}
fn request_origin(raw: &str) -> Result<Url> {
    #[cfg(test)]
    {
        let url = Url::parse(raw).map_err(|_| "Ask service is unavailable")?;
        if url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none()
        {
            return Ok(url);
        }
    }
    origin(raw)
}

fn bounded<T: for<'de> serde::Deserialize<'de>>(response: Response) -> Result<T> {
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE) {
        return Err("Ask response exceeds its size limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Ask response interrupted; recover the same operation")?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("Ask response exceeds its size limit".into());
    }
    strict_json_from_slice(&bytes).map_err(|_| "Invalid Ask response".into())
}

impl LocalIntelligenceTransport {
    pub fn new(connection: IntelligenceConnection) -> Result<Self> {
        request_origin(&connection.origin)?;
        let builder = Client::builder();
        #[cfg(not(test))]
        let builder = builder.https_only(true);
        let client = builder
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "Ask transport is unavailable")?;
        Ok(Self { client, connection })
    }

    fn url(&self, path: &str) -> Result<Url> {
        request_origin(&self.connection.origin)?
            .join(path)
            .map_err(|_| "Ask service is unavailable".into())
    }

    pub fn capability(&self) -> Result<AskCapabilityReply> {
        let response = self
            .client
            .get(self.url("v1/local-intelligence/capability")?)
            .bearer_auth(&self.connection.secret)
            .send()
            .map_err(|_| "Ask capability is unavailable")?;
        if !response.status().is_success() {
            return Err("Ask capability is unavailable".into());
        }
        let capability: AskCapabilityReply = bounded(response)?;
        if capability.scope != "vault_intelligence"
            || !matches!(capability.consent.as_str(), "active" | "missing")
        {
            return Err("Ask capability response is invalid".into());
        }
        Ok(capability)
    }

    pub fn history_capability(&self) -> Result<HistoryCapabilityReply> {
        let response = self
            .client
            .get(self.url("v1/local-intelligence/history-capability")?)
            .bearer_auth(&self.connection.secret)
            .send()
            .map_err(|_| "History capability is unavailable")?;
        if !response.status().is_success() {
            return Err("History capability is unavailable".into());
        }
        let capability: HistoryCapabilityReply = bounded(response)?;
        if capability.scope != "vault_intelligence"
            || !matches!(
                capability.history_consent.as_str(),
                "active" | "missing" | "outdated"
            )
            || capability.history_policy_version.is_empty()
        {
            return Err("History capability response is invalid".into());
        }
        Ok(capability)
    }

    pub fn set_history_consent(
        &self,
        request: &HistoryConsentRequest,
    ) -> Result<HistoryCapabilityReply> {
        let body = serde_json::to_vec(request).map_err(|_| "Invalid history consent request")?;
        let response = self
            .client
            .post(self.url("v1/local-intelligence/ask/consent")?)
            .bearer_auth(&self.connection.secret)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .map_err(|_| "History consent outcome is unknown")?;
        if !response.status().is_success() {
            return Err("History consent was rejected".into());
        }
        let capability: HistoryCapabilityReply = bounded(response)?;
        if capability.scope != "vault_intelligence"
            || !matches!(
                capability.history_consent.as_str(),
                "active" | "missing" | "outdated"
            )
            || capability.history_policy_version.is_empty()
        {
            return Err("History capability response is invalid".into());
        }
        Ok(capability)
    }

    pub fn post_history(&self, request: &HistoryRequest) -> Result<AskReceipt> {
        #[cfg(test)]
        if let Some(hook) = HISTORY_POST_HOOK
            .get_or_init(|| Mutex::new(None))
            .lock()
            .expect("history post hook lock")
            .clone()
        {
            hook();
        }
        let body = request.canonical_bytes()?;
        let response = self
            .client
            .post(self.url("v1/local-intelligence/ask")?)
            .bearer_auth(&self.connection.secret)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .map_err(|_| {
                "History Ask outcome is unknown; recover this operation before retrying"
            })?;
        self.receipt_response(response)
    }

    pub fn post(&self, request: &AskRequest) -> Result<AskReceipt> {
        let body = request.canonical_bytes()?;
        let response = self
            .client
            .post(self.url("v1/local-intelligence/ask")?)
            .bearer_auth(&self.connection.secret)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .map_err(|_| "Ask outcome is unknown; recover this operation before retrying")?;
        self.receipt_response(response)
    }

    pub fn get(&self, operation_id: &str) -> Result<ReceiptLookup> {
        let response = self
            .client
            .get(self.url(&format!("v1/local-intelligence/ask/{operation_id}"))?)
            .bearer_auth(&self.connection.secret)
            .send()
            .map_err(|_| "Ask receipt is unavailable; recover the same operation")?;
        if response.status().as_u16() == 404 {
            return Ok(ReceiptLookup::NotFound);
        }
        self.receipt_response(response).map(ReceiptLookup::Receipt)
    }

    /// Historical 404 is a no-receipt state, never authorization to POST again.
    pub fn recover_history(&self, operation_id: &str) -> Result<ReceiptLookup> {
        self.get(operation_id)
    }

    fn receipt_response(&self, response: Response) -> Result<AskReceipt> {
        let status = response.status().as_u16();
        if ![200, 202].contains(&status) {
            return Err(match status {
                401 | 403 => "Ask connection or consent is no longer authorized",
                409 => "Ask operation conflicts with an earlier request",
                _ => "Ask service rejected the request",
            }
            .into());
        }
        let receipt: AskReceipt = bounded(response)?;
        if (status == 202) != matches!(receipt.state.as_str(), "in_flight" | "unknown") {
            return Err("Ask receipt status is invalid".into());
        }
        Ok(receipt)
    }

    #[cfg(test)]
    pub(crate) fn test_from_connection(connection: IntelligenceConnection) -> Result<Self> {
        let url = Url::parse(&connection.origin).map_err(|_| "Invalid loopback")?;
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return Err("Test transport only permits loopback".into());
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| "Test client")?;
        Ok(Self { client, connection })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_intelligence::{AskCoverage, AskEvidence};
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
        time::Duration,
    };
    use uuid::Uuid;

    fn request() -> AskRequest {
        AskRequest {
            schema_version: "1.0".into(),
            operation_id: "00000000-0000-4000-8000-000000000001".into(),
            vault_id: "00000000-0000-4000-8000-000000000002".into(),
            question: "Who did I meet?".into(),
            coverage: AskCoverage {
                eligible_count: 1,
                selected_count: 1,
                limited: false,
                truncated_count: 0,
            },
            evidence: vec![AskEvidence {
                citation_id: "c1".into(),
                memory_id: "00000000-0000-4000-8000-000000000003".into(),
                memory_revision: 1,
                source_sha256: "a".repeat(64),
                captured_at: "2026-10-09T12:00:00Z".into(),
                evidence_kind: "human_note".into(),
                epistemic_state: "reported".into(),
                excerpt: "Met Ana.".into(),
            }],
        }
    }
    fn read_http(stream: &mut TcpStream) -> (String, Vec<u8>) {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 2048];
        let mut header_end = None;
        let mut content_length = 0_usize;
        loop {
            let n = stream.read(&mut chunk).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..n]);
            if header_end.is_none() {
                if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    let headers = String::from_utf8_lossy(&bytes[..pos + 4]);
                    content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                }
            }
            if header_end.is_some_and(|end| bytes.len() >= end + content_length) {
                break;
            }
        }
        let end = header_end.unwrap();
        (
            String::from_utf8_lossy(&bytes[..end]).into_owned(),
            bytes[end..end + content_length].to_vec(),
        )
    }
    fn connection(addr: std::net::SocketAddr) -> IntelligenceConnection {
        IntelligenceConnection::from_parts(
            "00000000-0000-4000-8000-000000000002".into(),
            format!("http://{addr}/"),
            "synthetic-intelligence-token".into(),
        )
    }
    #[test]
    fn post_uses_only_fixed_ask_route_bearer_and_canonical_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let req = request();
        let digest = req.payload_sha256().unwrap();
        let expected = req.canonical_bytes().unwrap();
        let operation_id = req.operation_id.clone();
        let vault_id = req.vault_id.clone();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, body) = read_http(&mut stream);
            assert!(headers.starts_with("POST /v1/local-intelligence/ask HTTP/1.1\r\n"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("authorization: bearer synthetic-intelligence-token"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("content-type: application/json"));
            assert_eq!(body, expected);
            let reply = serde_json::json!({
                "schema_version":"1.0", "operation_id":operation_id, "vault_id":vault_id,
                "payload_sha256":digest, "state":"complete",
                "result":{"status":"insufficient_evidence","sentences":[],"limitations":[]}, "error_code":null
            }).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply).unwrap();
        });
        let transport = LocalIntelligenceTransport::test_from_connection(connection(addr)).unwrap();
        let receipt = transport.post(&req).unwrap();
        assert_eq!(receipt.state, "complete");
        receipt.validate_for(&req).unwrap();
        server.join().unwrap();
    }
    #[test]
    fn recovery_treats_only_authenticated_receipt_404_as_absent() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, body) = read_http(&mut stream);
            assert!(body.is_empty());
            assert!(headers.starts_with(
                "GET /v1/local-intelligence/ask/00000000-0000-4000-8000-000000000001 HTTP/1.1\r\n"
            ));
            assert!(headers
                .to_ascii_lowercase()
                .contains("authorization: bearer synthetic-intelligence-token"));
            write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        let transport = LocalIntelligenceTransport::test_from_connection(connection(addr)).unwrap();
        assert!(matches!(
            transport.get(&request().operation_id).unwrap(),
            ReceiptLookup::NotFound
        ));
        server.join().unwrap();
    }

    #[test]
    fn history_capability_404_does_not_change_legacy_current_ask_capability() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, _) = read_http(&mut stream);
            assert!(headers.starts_with("GET /v1/local-intelligence/capability HTTP/1.1\r\n"));
            let reply = r#"{"scope":"vault_intelligence","consent":"active","enabled":true}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(),
                reply
            )
            .unwrap();
            drop(stream);
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, _) = read_http(&mut stream);
            assert!(
                headers.starts_with("GET /v1/local-intelligence/history-capability HTTP/1.1\r\n")
            );
            write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        let transport = LocalIntelligenceTransport::test_from_connection(connection(addr)).unwrap();
        assert!(transport.capability().unwrap().enabled);
        assert!(transport.history_capability().is_err());
        server.join().unwrap();
    }

    #[test]
    fn historical_receipt_404_never_triggers_a_second_post() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, body) = read_http(&mut stream);
            assert!(headers.starts_with(
                "GET /v1/local-intelligence/ask/00000000-0000-4000-8000-000000000011 HTTP/1.1\r\n"
            ));
            assert!(body.is_empty());
            write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });
        let transport = LocalIntelligenceTransport::test_from_connection(connection(addr)).unwrap();
        assert!(matches!(
            transport
                .recover_history("00000000-0000-4000-8000-000000000011")
                .unwrap(),
            ReceiptLookup::NotFound
        ));
        server.join().unwrap();
    }
    #[test]
    fn production_transport_rejects_non_https_origin() {
        let c = IntelligenceConnection::from_parts(
            Uuid::new_v4().to_string(),
            "http://example.test/".into(),
            "secret".into(),
        );
        assert!(LocalIntelligenceTransport::new(c).is_err());
    }
}
