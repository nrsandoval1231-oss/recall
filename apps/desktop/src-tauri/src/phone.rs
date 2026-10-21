//! Phone capture and ask for the native Recall library.
//!
//! This process is the Tailscale companion. It serves one mobile page and writes
//! through the same vault the desktop app uses. Provider processing requires
//! explicit per-capture consent and native configuration; credentials stay on
//! the desktop. No Cloud Postgres is used. Bind is a Tailscale
//! address or loopback unless every interface is explicitly allowed.

use crate::local_vault::{Vault, VaultMemory};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use uuid::Uuid;

const DEFAULT_PORT: u16 = 8787;
const MAX_BODY: usize = 26 * 1024 * 1024;
const MAX_QUESTION: usize = 4096;
const CAPTURES_PER_MINUTE: u32 = 30;
const ASKS_PER_MINUTE: u32 = 60;
const KEYWORD_LABEL: &str = "Local keyword retrieval. Related graph knowledge is optional and inferred.";
const ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BindMode {
    Loopback,
    Tailscale,
    Explicit,
    AllInterfaces,
}

#[derive(Debug)]
struct BindChoice {
    addr: SocketAddr,
    mode: BindMode,
}

struct PhoneRequest<'a> {
    method: &'a str,
    target: &'a str,
    headers: &'a [(&'a str, &'a str)],
    body: &'a [u8],
}

struct PhoneResponse {
    status: u16,
    content_type: String,
    extra: Vec<(String, String)>,
    body: Vec<u8>,
}

struct WindowLimiter {
    limit: u32,
    hits: VecDeque<Instant>,
}

impl WindowLimiter {
    fn new(limit: u32) -> Self {
        Self {
            limit,
            hits: VecDeque::new(),
        }
    }

    fn allow(&mut self, now: Instant) -> bool {
        if self.limit == u32::MAX {
            return true;
        }
        let window = Duration::from_secs(60);
        while self
            .hits
            .front()
            .is_some_and(|at| now.saturating_duration_since(*at) >= window)
        {
            self.hits.pop_front();
        }
        if self.hits.len() as u32 >= self.limit {
            return false;
        }
        self.hits.push_back(now);
        true
    }
}

pub fn run_from_env() -> Result<(), String> {
    let root = resolve_vault_root(
        env_nonempty("RECALL_VAULT_DIR").as_deref(),
        selection_file_from_env()?.as_deref(),
    )?;
    let vault = Vault::open(&root)?;
    let choice = decide_bind(
        env_nonempty("RECALL_PHONE_BIND").as_deref(),
        allow_all_interfaces(),
        port_from_env()?,
        detect_tailscale_command(),
    )?;
    eprintln!("{}", startup_banner(&root, &vault.id, &choice));
    let server = tiny_http::Server::http(choice.addr).map_err(|err| {
        format!(
            "Could not listen on {}. If this is a Tailscale address, Tailscale has to be running on this computer and the address has to belong to it. {err}",
            choice.addr
        )
    })?;
    let bound = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "The phone companion listens on TCP only.".to_string())?;
    eprintln!("Listening on {}", http_url(bound));
    let mut captures = WindowLimiter::new(CAPTURES_PER_MINUTE);
    let mut asks = WindowLimiter::new(ASKS_PER_MINUTE);
    for request in server.incoming_requests() {
        if let Err(err) = serve_one(&root, &mut captures, &mut asks, request) {
            eprintln!("recall-phone: {err}");
        }
    }
    Ok(())
}

fn serve_one(
    root: &Path,
    captures: &mut WindowLimiter,
    asks: &mut WindowLimiter,
    mut request: tiny_http::Request,
) -> Result<(), String> {
    let method = request.method().as_str().to_string();
    let target = request.url().to_string();
    let path = target
        .split('?')
        .next()
        .unwrap_or(target.as_str())
        .to_string();
    let limited = match (method.as_str(), path.as_str()) {
        ("POST", path) if path == "/capture" || path.starts_with("/processing/") => {
            !captures.allow(Instant::now())
        }
        ("POST", "/ask" | "/answer") => !asks.allow(Instant::now()),
        _ => false,
    };
    let headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().as_str().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect();
    let response = if limited {
        html(
            429,
            page(
                "Slow down",
                "<h1>Slow down</h1><p>Too many captures or questions in the last minute. Nothing was written.</p><p><a href=\"/\">Back</a></p>",
            ),
        )
    } else {
        let body = if method == "POST" {
            match read_body(&mut request) {
                Ok(body) => body,
                Err(err) => {
                    let response = html(
                        413,
                        page(
                            "Photo not saved",
                            &format!(
                                "<h1>Photo not saved</h1><p>{}</p><p><a href=\"/\">Back</a></p>",
                                esc(&err)
                            ),
                        ),
                    );
                    return respond(request, &method, &path, response);
                }
            }
        } else {
            Vec::new()
        };
        let pairs: Vec<(&str, &str)> = headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        handle(
            root,
            &PhoneRequest {
                method: &method,
                target: &target,
                headers: &pairs,
                body: &body,
            },
        )
    };
    respond(request, &method, &path, response)
}

fn respond(
    request: tiny_http::Request,
    method: &str,
    path: &str,
    response: PhoneResponse,
) -> Result<(), String> {
    let status = response.status;
    let mut output = tiny_http::Response::from_data(response.body).with_status_code(status);
    output = output.with_header(ascii_header("Content-Type", &response.content_type)?);
    output = output.with_header(ascii_header("Cache-Control", "no-store")?);
    output = output.with_header(ascii_header("X-Content-Type-Options", "nosniff")?);
    output = output.with_header(ascii_header("Referrer-Policy", "no-referrer")?);
    output = output.with_header(ascii_header("X-Frame-Options", "DENY")?);
    output = output.with_header(ascii_header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )?);
    for (name, value) in &response.extra {
        output = output.with_header(ascii_header(name, value)?);
    }
    request.respond(output).map_err(|err| err.to_string())?;
    eprintln!("recall-phone {method} {path} {status}");
    Ok(())
}

fn ascii_header(name: &str, value: &str) -> Result<tiny_http::Header, String> {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
        .map_err(|_| format!("refusing a non-ASCII header {name}"))
}

fn read_body(request: &mut tiny_http::Request) -> Result<Vec<u8>, String> {
    if request.body_length().unwrap_or(0) > MAX_BODY {
        return Err("The upload is larger than 26 MiB. Nothing was written.".into());
    }
    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|err| err.to_string())?;
    if body.len() > MAX_BODY {
        return Err("The upload is larger than 26 MiB. Nothing was written.".into());
    }
    Ok(body)
}

fn split_target(target: &str) -> (&str, &str) {
    match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    }
}

fn handle(root: &Path, request: &PhoneRequest<'_>) -> PhoneResponse {
    let (path, query) = split_target(request.target);
    if path.contains('\\') || path.split('/').any(|part| part == ".." || part == ".") {
        return html(
            404,
            page(
                "Not found",
                "<h1>Not found</h1><p><a href=\"/\">Back</a></p>",
            ),
        );
    }
    match (request.method, path) {
        ("GET" | "HEAD", "/" | "/index.html") => html(200, home_page()),
        ("GET" | "HEAD", "/companion.js") => bytes(
            200,
            "text/javascript; charset=utf-8",
            include_bytes!("phone/companion.js").to_vec(),
        ),
        ("GET" | "HEAD", "/phone-ui.js") => bytes(200, "text/javascript; charset=utf-8", include_bytes!("phone/ui.js").to_vec()),
        ("GET" | "HEAD", "/brand/monolith-mark.svg") => bytes(200, "image/svg+xml", include_bytes!("../../public/brand/monolith-mark.svg").to_vec()),
        ("GET" | "HEAD", "/brand/favicon.svg") => bytes(200, "image/svg+xml", include_bytes!("../../public/brand/favicon.svg").to_vec()),
        ("GET" | "HEAD", "/fonts/Inter-Regular.ttf") => bytes(200, "font/ttf", include_bytes!("../../public/fonts/Inter-Regular.ttf").to_vec()),
        ("GET" | "HEAD", "/fonts/Sora-Variable.ttf") => bytes(200, "font/ttf", include_bytes!("../../public/fonts/Sora-Variable.ttf").to_vec()),
        ("GET" | "HEAD", "/companion-sw.js") => bytes(
            200,
            "text/javascript; charset=utf-8",
            include_bytes!("phone/companion-sw.js").to_vec(),
        ),
        ("GET" | "HEAD", "/companion/library") => match Vault::open(root) {
            Ok(vault) => json(
                200,
                serde_json::json!({"library_id": vault.id, "format": "recall-companion-v1"}),
            ),
            Err(error) => vault_page(error),
        },
        ("GET" | "HEAD", "/ask" | "/capture" | "/answer") => html(
            405,
            page(
                "Use Capture and Ask",
                "<h1>Use Capture and Ask</h1><p><a href=\"/\">Back</a></p>",
            ),
        ),
        ("GET" | "HEAD", "/manifest.webmanifest") => bytes(
            200,
            "application/manifest+json",
            MANIFEST.as_bytes().to_vec(),
        ),
        ("GET" | "HEAD", "/icon.png") => bytes(200, "image/png", ICON_PNG.to_vec()),
        ("POST", "/capture") => {
            if let Err(response) = same_origin(request.headers) {
                return response;
            }
            capture(root, request)
        }
        ("POST", path) if path.starts_with("/processing/") && path.ends_with("/resume") => {
            if let Err(response) = same_origin(request.headers) {
                return response;
            }
            resume_processing(
                root,
                request,
                &path["/processing/".len()..path.len() - "/resume".len()],
            )
        }
        ("POST", "/ask") => {
            if query_contains_question(query) {
                return html(
                    400,
                    page(
                        "Ask on the page",
                        "<h1>Ask on the page</h1><p>The question stays in the form, not in the address.</p><p><a href=\"/\">Back</a></p>",
                    ),
                );
            }
            if let Err(response) = same_origin(request.headers) {
                return response;
            }
            ask(root, request)
        }
        ("POST", "/answer") => {
            if query_contains_question(query) {
                return html(400, page("Answer from notes", "<h1>Answer from notes</h1><p>The question stays in the form, not in the address.</p><p><a href=\"/\">Back</a></p>"));
            }
            if let Err(response) = same_origin(request.headers) { return response; }
            answer(root, request)
        }
        ("GET" | "HEAD", path) if path.starts_with("/saved/") => {
            saved(root, &path["/saved/".len()..])
        }
        ("GET" | "HEAD", path) if path.starts_with("/sources/") => {
            source(root, &path["/sources/".len()..])
        }
        ("GET" | "HEAD", _) => html(
            404,
            page(
                "Not found",
                "<h1>Not found</h1><p><a href=\"/\">Back</a></p>",
            ),
        ),
        _ => html(
            405,
            page(
                "Use Capture and Ask",
                "<h1>Use Capture and Ask</h1><p><a href=\"/\">Back</a></p>",
            ),
        ),
    }
}

fn query_contains_question(query: &str) -> bool {
    query.split('&').any(|pair| {
        let key = pair.split('=').next().unwrap_or("");
        key.eq_ignore_ascii_case("q")
    })
}

fn capture(root: &Path, request: &PhoneRequest<'_>) -> PhoneResponse {
    capture_with(root, request, &crate::companion_processing::enqueue)
}
fn capture_with(root: &Path, request: &PhoneRequest<'_>, dispatch: &impl Fn(&Vault, crate::companion_processing::Intent) -> Result<(), String>) -> PhoneResponse {
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(err) => return vault_page(err),
    };
    let receipt_requested = header(request.headers, "accept") == Some("application/json");
    // A queued request is bound to the library acknowledged when it was saved
    // on the phone. Never retarget it when the desktop selects another library.
    if receipt_requested
        && header(request.headers, "x-recall-library-id") != Some(vault.id.as_str())
    {
        return json(
            409,
            serde_json::json!({"error": "Different library; capture remains on this device"}),
        );
    }
    let form = match read_capture(request) {
        Ok(form) => form,
        Err(err) => {
            return not_saved(
                err.status,
                &err.message,
                &Uuid::new_v4().to_string(),
                "",
                false,
            );
        }
    };
    let saved = match &form.photo {
        Some(photo) => vault.capture(&form.operation_id, &form.filename, photo, &form.note),
        None => vault.capture_note(&form.operation_id, &form.note),
    };
    match saved {
        Ok(memory) => {
            if let Err(error) = vault.processing_snapshot(&memory.id, memory.revision) {
                return saved_processing_error(&memory.id, &error);
            }
            crate::knowledge::best_effort_refresh(&vault);
            // Build the immutable-source response before a dispatched worker
            // can own the writer. Delivery acknowledgement never depends on AI.
            let receipt = match vault.source(&memory.id) {
                Ok(source) => json(
                    200,
                    serde_json::json!({"format": "recall-capture-receipt-v1",
                    "library_id": vault.id, "memory_id": memory.id, "revision": memory.revision,
                    "source_sha256": source.sha256, "state": "received"}),
                ),
                Err(error) => vault_page(error),
            };
            if form.process_consent {
                match crate::companion_processing::consent(&vault, &memory, true) {
                    Ok(Some(intent)) => {
                        if let Err(error) = dispatch(&vault, intent) {
                            return if receipt_requested {
                                receipt
                            } else {
                                saved_processing_error(&memory.id, &error)
                            };
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        return if receipt_requested {
                            receipt
                        } else {
                            saved_processing_error(&memory.id, &error)
                        }
                    }
                }
            }
            if receipt_requested {
                receipt
            } else {
                redirect(&format!("/saved/{}", memory.id))
            }
        }
        Err(err) => not_saved(
            vault_status(&err),
            &err,
            &form.operation_id,
            &form.note,
            form.photo.is_some(),
        ),
    }
}

fn resume_processing(root: &Path, request: &PhoneRequest<'_>, memory_id: &str) -> PhoneResponse {
    let memory_id = match canonical_id(memory_id) {
        Ok(id) => id,
        Err(_) => return json(400, serde_json::json!({"error":"Invalid memory"})),
    };
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(error) => return vault_page(error),
    };
    let body = std::str::from_utf8(request.body).unwrap_or("");
    if form_value(body, "library_id").ok().as_deref() != Some(vault.id.as_str()) {
        return html(409, page("Different library", "<h1>Different library</h1><p>Nothing was sent. Return to the saved memory in its original library.</p>"));
    }
    let intent = match crate::companion_processing::recoverable(&vault, &memory_id) {
        Ok(intent) => intent,
        Err(error) => return html(403, page("Processing needs review", &format!("<h1>Processing needs review</h1><p>{}</p><p>Nothing new was sent. Inspect the saved source and authorization on desktop.</p>", esc(&error)))),
    };
    if crate::companion_processing::status(&vault, &memory_id).ok().flatten().is_some_and(|outcome| outcome.state == "failed" && [400,401,403,404,422,429].iter().any(|code| outcome.message.contains(&format!("HTTP {code}")))) {
        if let Err(error) = crate::companion_processing::retry_rejected(&vault, &memory_id) { return saved_processing_error(&memory_id, &error); }
    }
    match crate::companion_processing::enqueue(&vault, intent) {
        Ok(()) => redirect(&format!("/saved/{memory_id}")),
        Err(error) => saved_processing_error(&memory_id, &error),
    }
}

fn saved_processing_error(memory_id: &str, error: &str) -> PhoneResponse {
    html(200, page("Capture saved; processing stopped", &format!("<h1>Capture saved; processing stopped</h1><p>{}</p><p><a href=\"/saved/{}\">Inspect the saved capture</a></p>", esc(error), esc(memory_id))))
}

fn not_saved(
    status: u16,
    message: &str,
    operation_id: &str,
    note: &str,
    had_photo: bool,
) -> PhoneResponse {
    let title = if had_photo {
        "Photo not saved"
    } else {
        "Note not saved"
    };
    let detail = if had_photo {
        "Nothing new was uploaded to a cloud, and Claude was not called. If this same photo was already saved, <a href=\"/\">start a new capture</a>."
    } else {
        "Nothing new was written. Nothing was uploaded to a cloud, and Claude was not called."
    };
    html(
        status,
        page(
            title,
            &format!(
                "<h1>{title}</h1><p>{}</p><p>{detail}</p>{}",
                esc(message),
                capture_form(operation_id, note)
            ),
        ),
    )
}

struct CaptureForm {
    operation_id: String,
    filename: String,
    photo: Option<Vec<u8>>,
    note: String,
    process_consent: bool,
}

#[derive(Debug)]
struct FormError {
    status: u16,
    message: String,
}

fn read_capture(request: &PhoneRequest<'_>) -> Result<CaptureForm, FormError> {
    let content_type = header(request.headers, "content-type").unwrap_or("");
    if content_type
        .to_ascii_lowercase()
        .starts_with("multipart/form-data")
    {
        return read_multipart_capture(content_type, request.body);
    }
    if content_type
        .to_ascii_lowercase()
        .starts_with("application/x-www-form-urlencoded")
    {
        return read_urlencoded_capture(request);
    }
    if !(content_type.to_ascii_lowercase().starts_with("image/")
        || content_type.eq_ignore_ascii_case("application/octet-stream")
        || content_type.is_empty())
    {
        return Err(FormError {
            status: 400,
            message: "Send the note as a form, or the photo as a form upload.".into(),
        });
    }
    let note = header(request.headers, "x-recall-note")
        .unwrap_or("")
        .to_string();
    if request.body.is_empty() {
        if note.trim().is_empty() {
            return Err(FormError {
                status: 400,
                message: "Write a note, or choose a photo. A photo is optional.".into(),
            });
        }
        return Ok(CaptureForm {
            operation_id: operation_id(header(request.headers, "x-recall-operation-id"))?,
            filename: String::new(),
            photo: None,
            note,
            process_consent: header_consent(request.headers)?,
        });
    }
    Ok(CaptureForm {
        operation_id: operation_id(header(request.headers, "x-recall-operation-id"))?,
        filename: "photo".into(),
        photo: Some(request.body.to_vec()),
        note,
        process_consent: header_consent(request.headers)?,
    })
}

fn read_urlencoded_capture(request: &PhoneRequest<'_>) -> Result<CaptureForm, FormError> {
    let text = std::str::from_utf8(request.body).map_err(|_| FormError {
        status: 400,
        message: "That field is not UTF-8.".into(),
    })?;
    let note = form_value(text, "note").map_err(|message| FormError {
        status: 400,
        message,
    })?;
    let operation = form_value(text, "operation_id").map_err(|message| FormError {
        status: 400,
        message,
    })?;
    if note.trim().is_empty() {
        return Err(FormError {
            status: 400,
            message: "Write a note, or choose a photo. A photo is optional.".into(),
        });
    }
    let operation = if operation.trim().is_empty() {
        None
    } else {
        Some(operation)
    };
    Ok(CaptureForm {
        operation_id: operation_id(operation.as_deref())?,
        filename: String::new(),
        photo: None,
        note,
        process_consent: form_consent(text)?,
    })
}

fn read_multipart_capture(content_type: &str, body: &[u8]) -> Result<CaptureForm, FormError> {
    let boundary = boundary(content_type).map_err(|message| FormError {
        status: 400,
        message,
    })?;
    let mut photo: Option<(String, Vec<u8>)> = None;
    let mut note = String::new();
    let mut operation = None;
    let mut process_consent = None;
    for part in split_multipart(body, &boundary).map_err(|message| FormError {
        status: 400,
        message,
    })? {
        match part.name {
            "photo" => {
                if part.body.is_empty() {
                    continue;
                }
                if photo.is_some() {
                    return Err(FormError {
                        status: 400,
                        message: "Send one photo.".into(),
                    });
                }
                photo = Some((photo_filename(part.filename), part.body.to_vec()));
            }
            "note" => note = utf8_field(part.body)?,
            "operation_id" => operation = Some(utf8_field(part.body)?),
            "process_consent" => {
                if process_consent.is_some() {
                    return Err(FormError {
                        status: 400,
                        message: "Repeated processing consent".into(),
                    });
                }
                process_consent = Some(consent_value(&utf8_field(part.body)?)?);
            }
            _ => {}
        }
    }
    let (filename, photo) = match photo {
        Some((filename, photo)) => (filename, Some(photo)),
        None => {
            if note.trim().is_empty() {
                return Err(FormError {
                    status: 400,
                    message: "Write a note, or choose a photo. A photo is optional.".into(),
                });
            }
            (String::new(), None)
        }
    };
    Ok(CaptureForm {
        operation_id: operation_id(operation.as_deref())?,
        filename,
        photo,
        note,
        process_consent: process_consent.unwrap_or(false),
    })
}

fn form_consent(body: &str) -> Result<bool, FormError> {
    let mut value = None;
    for pair in body.split('&') {
        let (key, raw) = pair.split_once('=').unwrap_or((pair, ""));
        if url_decode(key).map_err(|message| FormError {
            status: 400,
            message,
        })? == "process_consent"
        {
            if value.is_some() {
                return Err(FormError {
                    status: 400,
                    message: "Repeated processing consent".into(),
                });
            }
            value = Some(consent_value(&url_decode(raw).map_err(|message| {
                FormError {
                    status: 400,
                    message,
                }
            })?)?);
        }
    }
    Ok(value.unwrap_or(false))
}
fn header_consent(headers: &[(&str, &str)]) -> Result<bool, FormError> {
    let mut values = headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("x-recall-process-consent"));
    let value = values.next();
    if values.next().is_some() {
        return Err(FormError {
            status: 400,
            message: "Repeated processing consent".into(),
        });
    }
    match value {
        Some((_, value)) => consent_value(value),
        None => Ok(false),
    }
}
fn consent_value(value: &str) -> Result<bool, FormError> {
    match value {
        "" | "false" => Ok(false),
        "true" => Ok(true),
        _ => Err(FormError {
            status: 400,
            message: "Processing consent must be explicit true or false".into(),
        }),
    }
}

fn ask(root: &Path, request: &PhoneRequest<'_>) -> PhoneResponse {
    let question = match read_question(request) {
        Ok(question) => question,
        Err(err) => {
            return html(
                err.status,
                page(
                    "Ask",
                    &format!("<h1>Ask</h1><p>{}</p>{}", esc(&err.message), ask_form("")),
                ),
            );
        }
    };
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(err) => return vault_page(err),
    };
    let answer = match source_answer(&vault, &question) {
        Ok(answer) => answer,
        Err(err) => return vault_page(err),
    };
    html(
        200,
        page("Ask", &format!("{answer}{}", ask_form(&question))),
    )
}

fn answer(root: &Path, request: &PhoneRequest<'_>) -> PhoneResponse {
    let (question, request_id) = match read_answer_request(request) {
        Ok(form) => form,
        Err(err) => return html(err.status, page("Answer from notes", &format!("<h1>Answer from notes</h1><p>{}</p>{}", esc(&err.message), ask_form("")))),
    };
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(err) => return vault_page(err),
    };
    let start = match crate::knowledge::begin_answer(&vault, &request_id) {
        Ok(start) => start,
        Err(err) => return html(400, page("Answer from notes", &format!("<h1>Answer from notes</h1><p>{}</p>{}", esc(&err), ask_form(&question)))),
    };
    let mut result = match crate::memory_query::answer_with_knowledge(&vault, &question, &request_id, start) {
        Ok(result) => result,
        Err(err) => return html(200, page("Answer from notes", &format!("<h1>Answer from notes</h1><p>{}</p>{}", esc(&err), ask_form(&question)))),
    };
    let verified_sources = if result.status == "supported" {
        match verify_answer_sources(&vault, &result.selections) {
            Some(sources) => sources,
            None => {
                result.status = "stale".into();
                result.message = "A source changed before the phone could display the result. No quotations are shown; search again.".into();
                result.selections.clear();
                Vec::new()
            }
        }
    } else { Vec::new() };
    let rendered = render_memory_answer(result, &verified_sources);
    html(200, page("Answer from notes", &format!("{rendered}{}", ask_form(&question))))
}

fn read_answer_request(request: &PhoneRequest<'_>) -> Result<(String, String), FormError> {
    let content_type = header(request.headers, "content-type").unwrap_or("").to_ascii_lowercase();
    if !content_type.starts_with("application/x-www-form-urlencoded") {
        return Err(FormError { status: 400, message: "Use the Answer from notes form.".into() });
    }
    if request.body.len() > MAX_QUESTION + 256 {
        return Err(FormError { status: 400, message: "That question is too long to answer.".into() });
    }
    let text = std::str::from_utf8(request.body).map_err(|_| FormError { status: 400, message: "The answer form is not UTF-8.".into() })?;
    let question = unique_form_value(text, "q")?;
    let request_id = unique_form_value(text, "request_id")?;
    if question.trim().is_empty() || question.len() > MAX_QUESTION || question.chars().any(char::is_control) {
        return Err(FormError { status: 400, message: "Ask a bounded memory question.".into() });
    }
    let parsed = Uuid::parse_str(&request_id).map_err(|_| FormError { status: 400, message: "The answer request ID is invalid.".into() })?;
    if parsed.to_string() != request_id {
        return Err(FormError { status: 400, message: "The answer request ID is invalid.".into() });
    }
    Ok((question, request_id))
}

fn unique_form_value(body: &str, key: &str) -> Result<String, FormError> {
    let mut found = None;
    for pair in body.split('&').filter(|pair| !pair.is_empty()) {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded_key = url_decode(raw_key).map_err(|message| FormError { status: 400, message })?;
        if decoded_key != key { continue; }
        if found.is_some() { return Err(FormError { status: 400, message: format!("The answer form contains duplicate {key} fields.") }); }
        found = Some(url_decode(raw_value).map_err(|message| FormError { status: 400, message })?);
    }
    found.ok_or_else(|| FormError { status: 400, message: format!("The answer form is missing {key}.") })
}

fn answer_form(question: &str, request_id: &str, provider: &str) -> String {
    format!("<section aria-label=\"Quoted answer request\"><p>Answer from notes sends this question and its selected current note excerpts to <strong>{}</strong>. Recall shows exact quotations, not a synthesized or verified answer. Provider charges may apply.</p><form method=\"post\" action=\"/answer\"><input type=\"hidden\" name=\"q\" value=\"{}\"><input type=\"hidden\" name=\"request_id\" value=\"{}\"><button class=\"secondary\" type=\"submit\">Answer from notes</button></form></section>", esc(provider), esc(question), esc(request_id))
}

fn answer_offer(vault: &Vault, question: &str) -> String {
    match crate::knowledge::status(vault) {
        Ok(status) if status.answer_enabled => match status.answer_provider.as_deref() {
            Some(provider) => answer_form(question, &Uuid::new_v4().to_string(), provider),
            None => "<p class=\"fine\">Quoted answers are unavailable because the configured provider identity could not be confirmed.</p>".into(),
        },
        Ok(_) => "<p class=\"fine\">Quoted answers are off. Enable them separately in desktop Settings; this phone cannot change provider consent.</p>".into(),
        Err(_) => "<p class=\"fine\">Quoted-answer consent could not be checked. No model answer is available.</p>".into(),
    }
}

struct VerifiedPhoneAnswerSource { memory: VaultMemory, source_sha256: String }

fn verify_answer_sources(vault: &Vault, selections: &[crate::knowledge::AnswerSelection]) -> Option<Vec<VerifiedPhoneAnswerSource>> {
    let mut verified = Vec::with_capacity(selections.len());
    for selection in selections {
        let snapshot = vault.processing_snapshot(&selection.source_id, selection.revision).ok()?;
        let note_sha256 = hex::encode(Sha256::digest(snapshot.memory.note.as_bytes()));
        if snapshot.memory.id != selection.source_id || snapshot.memory.revision != selection.revision
            || snapshot.memory.state != "active" || snapshot.memory.conflict.is_some()
            || snapshot.source.sha256 != selection.source_sha256 || note_sha256 != selection.note_sha256 {
            return None;
        }
        verified.push(VerifiedPhoneAnswerSource { memory: snapshot.memory, source_sha256: snapshot.source.sha256 });
    }
    if verified.is_empty() { None } else { Some(verified) }
}

fn render_memory_answer(mut answer: crate::knowledge::MemoryAnswer, current: &[VerifiedPhoneAnswerSource]) -> String {
    let selections = if answer.status == "supported" { answer.selections.as_slice() } else { &[] };
    let mut cards = String::new();
    for selection in selections {
        let source = current.iter().find(|source| source.memory.id == selection.source_id && source.memory.revision == selection.revision && source.source_sha256 == selection.source_sha256);
        let Some(source) = source else { continue };
        let memory = &source.memory;
        cards.push_str(&format!("<article><h2>Exact passage from {}</h2><blockquote>{}</blockquote><p class=\"path\">Note revision {} · {}</p><p class=\"path\">SHA-256: {}</p><p><a href=\"/saved/{}\">Inspect supporting note and original</a></p></article>",
            esc(&title_for(memory)), esc(&selection.quote), selection.revision,
            esc(memory.note_path.as_deref().unwrap_or("Captured note")), esc(&source.source_sha256), esc(&memory.id)));
    }
    if answer.status == "supported" && cards.is_empty() {
        answer.status = "stale".into();
        answer.message = "A source changed before display. No quotations are shown; search again.".into();
    }
    let provider = answer.answer_provider.as_deref().map(|value| format!("<p class=\"fine\">Answer provider: {}</p>", esc(value))).unwrap_or_default();
    format!("<section aria-label=\"Quoted answer result\"><h1>Quoted answer from notes</h1><p class=\"fine\">Status: {}</p><p>{}</p>{cards}{provider}<p class=\"fine\">These are exact source quotations selected from current notes, not a verified synthesized answer.</p></section>", esc(&answer.status), esc(&answer.message))
}

fn read_question(request: &PhoneRequest<'_>) -> Result<String, FormError> {
    let content_type = header(request.headers, "content-type").unwrap_or("");
    let question = if content_type.to_ascii_lowercase().starts_with("multipart/") {
        let boundary = boundary(content_type).map_err(|message| FormError {
            status: 400,
            message,
        })?;
        let mut question = None;
        for part in split_multipart(request.body, &boundary).map_err(|message| FormError {
            status: 400,
            message,
        })? {
            if part.name == "q" {
                question = Some(utf8_field(part.body)?);
            }
        }
        question.unwrap_or_default()
    } else {
        let text = std::str::from_utf8(request.body).map_err(|_| FormError {
            status: 400,
            message: "The question is not UTF-8.".into(),
        })?;
        form_value(text, "q").map_err(|message| FormError {
            status: 400,
            message,
        })?
    };
    if question.len() > MAX_QUESTION {
        return Err(FormError {
            status: 400,
            message: "That question is too long to search.".into(),
        });
    }
    Ok(question)
}

fn source_answer(vault: &Vault, question: &str) -> Result<String, String> {
    if question.trim().is_empty() {
        return Ok(abstain("Type a question to search the notes."));
    }
    let answer = crate::memory_query::ask_with_knowledge(vault, question)?;
    Ok(format!("{}{}", render_source_answer(answer), answer_offer(vault, question)))
}

fn render_source_answer(answer: crate::memory_query::Answer) -> String {
    if answer.hits.is_empty() && answer.graph_relationships.is_empty() {
        return abstain("Nothing in the notes or related knowledge matches that. This is retrieval, not a generated answer.");
    }
    let mut cards = String::new();
    for hit in &answer.hits {
        let extension = match hit.mime_type.as_str() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => "txt",
        };
        let paths = format!(
            "Recall/Memories/{} · Recall/Sources/{}.{extension}",
            hit.note_basename, hit.memory_id
        );
        let range = match (hit.original_start_byte, hit.original_end_byte) {
            (Some(start), Some(end)) => {
                format!("<p class=\"fine\">Original excerpt: bytes {start}–{end}</p>")
            }
            _ => String::new(),
        };
        let correction = if hit.human_corrected {
            " · Includes user corrections; the original below is unchanged."
        } else {
            ""
        };
        let fallback = format!("Memory captured {}", hit.captured_at.chars().take(10).collect::<String>());
        let title = title_from_note(if hit.current_excerpt.trim().is_empty() { &hit.original_excerpt } else { &hit.current_excerpt }, &fallback);
        cards.push_str(&format!("<article data-memory=\"{}\"><h2>{}</h2><p>{}</p><p>Current note · revision {}{correction}</p><p class=\"fine\">Captured {} · Note revised {}</p><p>{}</p><h3>Original evidence</h3><p>{}</p>{range}<details><summary>Source verification</summary><p class=\"path\">SHA-256: {}</p><p class=\"path\">{}</p></details><p><a href=\"/sources/{}\">Open original</a> · <a href=\"/saved/{}\">Inspect memory</a></p></article>",esc(&hit.memory_id),esc(&title),esc(&hit.match_reason),hit.revision,esc(&hit.captured_at),esc(&hit.updated_at),esc(&hit.current_excerpt),esc(&hit.original_excerpt),esc(&hit.source_sha256),esc(&paths),esc(&hit.memory_id),esc(&hit.memory_id)));
    }
    let mut graph_cards = String::new();
    for relationship in &answer.graph_relationships {
        graph_cards.push_str(&format!("<article class=\"inferred\" data-fact=\"{}\"><h2>Related knowledge (inferred)</h2><p>{}</p><p>{} ({}) — {} → {} ({})</p><p class=\"fine\">Inferred and unverified. These source notes support the association; they do not prove identity or certainty.</p><ul>",
            esc(&relationship.id), esc(&relationship.fact), esc(&relationship.subject), esc(&relationship.subject_type), esc(&relationship.predicate), esc(&relationship.object), esc(&relationship.object_type)));
        for support in &relationship.supports {
            graph_cards.push_str(&format!("<li><a href=\"/sources/{}\">Open original source</a><p>Current Markdown note quote:</p><blockquote>{}</blockquote></li>", esc(&support.source_id), esc(&support.quote)));
        }
        graph_cards.push_str("</ul></article>");
    }
    let heading = if answer.hits.is_empty() { "Related inferred knowledge" } else { "Source-backed matches" };
    let disclosure = if answer.graph_relationships.is_empty() {
        KEYWORD_LABEL.to_owned()
    } else {
        "Graph relationships are inferred and unverified. When enabled, the question and eligible notes may be processed by the configured, disclosed providers. This is retrieval, not a generated answer.".to_owned()
    };
    format!("<h1>{heading}</h1><p class=\"fine\">{}</p><details class=\"retrieval-details\"><summary>How these matches were found</summary><p>{}</p></details>{cards}{graph_cards}",esc(&disclosure),esc(&answer.message))
}

// Only retry inspection on brief native writer contention. Never retry a model
// invocation, mutation request or integrity failure here.
fn read_retry<T>(mut inspect: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    for attempt in 0..5 {
        match inspect() {
            Err(error) if error == "Vault is busy in another Recall process" && attempt < 4 => {
                std::thread::sleep(Duration::from_millis(25));
            }
            result => return result,
        }
    }
    unreachable!()
}

fn saved(root: &Path, id: &str) -> PhoneResponse {
    let id = match canonical_id(id) {
        Ok(id) => id,
        Err(_) => {
            return html(
                404,
                page(
                    "Not found",
                    "<h1>Not found</h1><p><a href=\"/\">Back</a></p>",
                ),
            );
        }
    };
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(err) => return vault_page(err),
    };
    let memories = match read_retry(|| vault.list_with_deleted("", false)) {
        Ok(memories) => memories,
        Err(err) => return html(vault_status(&err), page("Memory temporarily unavailable", &format!("<h1>Memory temporarily unavailable</h1><p>{}</p><p>Processing may already be running. <a href=\"/saved/{}\">Refresh this memory</a> to inspect its current status.</p>", esc(&err), esc(&id)))),
    };
    let Some(memory) = memories.into_iter().find(|memory| memory.id == id) else {
        return html(
            404,
            page(
                "Not in the vault",
                "<h1>Not in the vault</h1><p><a href=\"/\">Back</a></p>",
            ),
        );
    };
    if memory.state != "active" || memory.conflict.is_some() {
        return html(
            409,
            page(
                "Resolve on the desktop",
                "<h1>Resolve this note on the desktop</h1><p>This phone will not replace a local edit or a conflict.</p><p><a href=\"/\">Back</a></p>",
            ),
        );
    }
    let note_path = note_rel(&memory);
    let recovery = match read_retry(|| crate::companion_processing::recoverable(&vault, &memory.id)) {
        Ok(_) => format!("<form method=\"post\" action=\"/processing/{}/resume\"><input type=\"hidden\" name=\"library_id\" value=\"{}\"><button class=\"secondary\" type=\"submit\">Resume previously authorized processing</button><p class=\"fine\">Uses the same saved authorization and operation IDs. Unknown provider delivery or changed sources still require desktop review; this does not authorize a new attempt.</p></form>", esc(&memory.id), esc(&vault.id)),
        Err(_) => String::new(),
    };
    let processing = match read_retry(|| crate::companion_processing::status(&vault, &memory.id)) {
        Ok(Some(status)) => format!("<section><h2>Processing: {}</h2><p>{}</p><a href=\"/saved/{}\">Refresh processing status</a>{recovery}</section>", esc(&status.state), esc(&status.message), esc(&memory.id)),
        Ok(None) if !recovery.is_empty() => format!("<section><h2>Processing pending</h2><p>Prior authorization is saved. No completed organization receipt is available.</p>{recovery}</section>"),
        Ok(None) => "<p>No resumable source-specific processing authorization is available. Review on desktop.</p>".into(),
        Err(_) => format!("<p>Native processing is busy or needs review. <a href=\"/saved/{}\">Refresh status</a></p>{recovery}", esc(&memory.id)),
    };
    let original_path = source_rel(&memory).unwrap_or_else(|| format!("Recall/Sources/{}.txt", memory.id));
    let source_card = match read_retry(|| vault.source(&memory.id)) {
        Ok(source) => format!("<a class=\"source-action\" href=\"/sources/{}\">Open original evidence</a><details><summary>Source verification</summary><p class=\"path\">Original SHA-256: {}</p><p class=\"path\">{}</p></details>", esc(&memory.id), esc(&source.sha256), esc(&format!("{} · {}", note_path, original_path))),
        Err(_) => "<p>Original evidence unavailable; resolve on desktop.</p>".into(),
    };
    let photo = source_rel(&memory).map(|_| format!("<img src=\"/sources/{}\" alt=\"Original page\">", esc(&memory.id))).unwrap_or_default();
    let original_kind = if photo.is_empty() { "text" } else { "photo" };
    let body = format!("<section class=\"memory-detail\"><p class=\"eyebrow\">MEMORY DETAIL</p><h1>{}</h1><p class=\"fine\">Captured {} · Revision {}</p>{photo}<p class=\"memory-text\">{}</p><p class=\"saved-receipt\">Saved in the desktop vault</p><p class=\"fine\">The original {original_kind} is preserved separately. Nothing is sent without source-specific consent.</p>{source_card}</section>",
        esc(&title_for(&memory)), esc(&memory.captured_at), memory.revision, esc(&memory.note));
    html(
        200,
        page(
            "Saved in the desktop vault",
            &format!(
                "{body}{processing}<details><summary>Capture another memory</summary>{}</details><details><summary>Ask MONOLITH</summary><p class=\"fine\">{KEYWORD_LABEL}</p>{}</details><section><p data-testid=\"connection-state\" role=\"status\">Connecting to library…</p><p id=\"local-status\" role=\"status\"></p><button id=\"retry-queue\" type=\"button\">Retry queued captures</button><div data-testid=\"outbox\"></div></section><script src=\"/companion.js\" defer></script>",
                capture_form(&Uuid::new_v4().to_string(), "").replace("<h1 id=\"capture-heading\">Write a memory</h1>", "<h2>Write a memory</h2>"),
                ask_form("")
            ),
        ),
    )
}

fn source(root: &Path, id: &str) -> PhoneResponse {
    let id = match canonical_id(id) {
        Ok(id) => id,
        Err(_) => {
            return html(
                404,
                page(
                    "Not found",
                    "<h1>Not found</h1><p><a href=\"/\">Back</a></p>",
                ),
            );
        }
    };
    let vault = match Vault::open(root) {
        Ok(vault) => vault,
        Err(err) => return vault_page(err),
    };
    match vault.source(&id) {
        Ok(source) => {
            let filename = match source.mime_type.as_str() {
                "image/jpeg" => "original.jpg",
                "image/webp" => "original.webp",
                "text/plain" => "original.txt",
                _ => "original.png",
            };
            let mut response = bytes(200, &source.mime_type, source.bytes);
            response.extra.push((
                "Content-Disposition".into(),
                format!("inline; filename=\"{filename}\""),
            ));
            response
        }
        Err(_) => html(
            404,
            page(
                "Original unavailable",
                "<h1>Original unavailable</h1><p>The page is missing, or the desktop note needs to be resolved before its photo can be opened.</p><p><a href=\"/\">Back</a></p>",
            ),
        ),
    }
}

fn same_origin(headers: &[(&str, &str)]) -> Result<(), PhoneResponse> {
    // Browsers set both of these. A file upload from this page is same-origin and
    // may send Origin: null. A page on another site cannot claim same-origin.
    let site = header(headers, "sec-fetch-site");
    let origin = header(headers, "origin")
        .map(str::trim)
        .map(|value| value.trim_end_matches('/'));
    let host = header(headers, "host").unwrap_or("");
    let expected = format!("http://{host}");
    let secure_expected = format!("https://{host}");
    let site_ok = site.is_none_or(|value| value.eq_ignore_ascii_case("same-origin"));
    let origin_ok = origin.is_none_or(|value| {
        value.eq_ignore_ascii_case("null")
            || value.eq_ignore_ascii_case(&expected)
            || value.eq_ignore_ascii_case(&secure_expected)
    });
    if site_ok && origin_ok {
        return Ok(());
    }
    eprintln!(
        "recall-phone refused cross-site post site={} origin={} host={host}",
        site.unwrap_or("-"),
        origin.unwrap_or("-")
    );
    Err(html(
        403,
        page(
            "Refused",
            "<h1>Refused</h1><p>Open the Recall page on this computer and use the form there.</p>",
        ),
    ))
}

fn home_page() -> String {
    let shell = include_str!("phone/home.html")
        .replace("{{CAPTURE}}", &capture_form(&Uuid::new_v4().to_string(), ""))
        .replace("{{ASK}}", &ask_form(""))
        .replace("{{KEYWORD_LABEL}}", KEYWORD_LABEL);
    page("Recall — Your memories belong here", &shell)
}

fn capture_form(operation_id: &str, note: &str) -> String {
    format!(
        "<section class=\"capture-form\"><h1 id=\"capture-heading\">Write a memory</h1><form method=\"post\" action=\"/capture\" enctype=\"multipart/form-data\"><input type=\"hidden\" name=\"operation_id\" value=\"{}\"><label>Note, in your words<textarea name=\"note\" aria-describedby=\"note-error\" maxlength=\"262144\" placeholder=\"Jot down a moment, a thought, or something you never want to forget.\">{}</textarea></label><p id=\"note-error\" class=\"field-error\" role=\"alert\"></p><div id=\"photo-preview\" hidden></div><label>Photo or file, optional<input type=\"file\" name=\"photo\" aria-describedby=\"photo-error\" accept=\"image/png,image/jpeg,image/webp\" capture=\"environment\"></label><p id=\"photo-error\" class=\"field-error\" role=\"alert\"></p><label class=\"capture-consent\"><input type=\"checkbox\" name=\"process_consent\" value=\"true\"> Send this saved source to Jev and Claude with up to four relevant vault excerpts. Provider charges apply.</label><div class=\"capture-save\"><p id=\"capture-error\" class=\"field-error\" role=\"alert\"></p><button type=\"submit\">Save capture</button></div></form><p class=\"fine\">Your original is saved first. Processing is optional.</p></section>",
        esc(operation_id),
        esc(note)
    )
}

fn ask_form(question: &str) -> String {
    format!(
        "<form method=\"post\" action=\"/ask\"><label>Ask the notes<input type=\"search\" placeholder=\"What are you trying to remember?\" name=\"q\" aria-describedby=\"ask-error\" maxlength=\"4096\" value=\"{}\" autocomplete=\"off\" required></label><p id=\"ask-error\" class=\"field-error\" role=\"alert\"></p><button class=\"secondary\" type=\"submit\">Search notes</button></form>",
        esc(question)
    )
}

fn page(title: &str, main: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\"><meta name=\"apple-mobile-web-app-capable\" content=\"yes\"><meta name=\"mobile-web-app-capable\" content=\"yes\"><meta name=\"apple-mobile-web-app-title\" content=\"MONOLITH\"><meta name=\"theme-color\" content=\"#050607\"><meta name=\"robots\" content=\"noindex, nofollow\"><link rel=\"manifest\" href=\"/manifest.webmanifest\"><link rel=\"icon\" href=\"/brand/favicon.svg\"><title>{}</title><style>{}</style></head><body><header class=\"phone-brand\"><a href=\"/#home\" aria-label=\"MONOLITH home\"><img src=\"/brand/monolith-mark.svg\" alt=\"\"><span>MONOLITH</span></a><span class=\"brand-signature\">Your world. Connected.</span></header><main>{}</main></body></html>",
        esc(title),
        PAGE_CSS,
        main
    )
}

const PAGE_CSS: &str = concat!(include_str!("../../../../packages/design-tokens/src/brand.css"), "\n", include_str!("phone/phone.css"));

const MANIFEST: &str = r##"{
  "name": "MONOLITH",
  "short_name": "MONOLITH",
  "display": "standalone",
  "start_url": "/",
  "background_color": "#050607",
  "theme_color": "#050607",
  "icons": [{ "src": "/icon.png", "sizes": "32x32", "type": "image/png", "purpose": "any" }]
}"##;

fn html(status: u16, body: String) -> PhoneResponse {
    bytes(status, "text/html; charset=utf-8", body.into_bytes())
}

fn bytes(status: u16, content_type: &str, body: Vec<u8>) -> PhoneResponse {
    PhoneResponse {
        status,
        content_type: content_type.into(),
        extra: Vec::new(),
        body,
    }
}

fn json(status: u16, value: serde_json::Value) -> PhoneResponse {
    bytes(status, "application/json", value.to_string().into_bytes())
}

fn redirect(location: &str) -> PhoneResponse {
    let mut response = html(
        303,
        page(
            "Saved",
            &format!(
                "<h1>Saved</h1><p><a href=\"{}\">Open the saved page</a></p>",
                esc(location)
            ),
        ),
    );
    response
        .extra
        .push(("Location".into(), location.to_string()));
    response
}

fn vault_page(err: String) -> PhoneResponse {
    html(
        vault_status(&err),
        page(
            "Vault unavailable",
            &format!(
                "<h1>Vault unavailable</h1><p>{}</p><p>Nothing was sent to Claude.</p><p><a href=\"/\">Back</a></p>",
                esc(&err)
            ),
        ),
    )
}

fn vault_status(err: &str) -> u16 {
    if err.contains("Vault is busy") {
        409
    } else if err.contains("exceeds") || err.contains("too large") || err.contains("26 MiB") {
        413
    } else {
        400
    }
}

fn abstain(message: &str) -> String {
    format!(
        "<h1>No matching note</h1><p>{}</p><p class=\"fine\">{KEYWORD_LABEL}</p>",
        esc(message)
    )
}

fn header<'a>(headers: &'a [(&str, &str)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| *value)
}

fn operation_id(value: Option<&str>) -> Result<String, FormError> {
    let value = value.unwrap_or("").trim();
    if value.is_empty() {
        return Ok(Uuid::new_v4().to_string());
    }
    canonical_id(value).map_err(|_| FormError {
        status: 400,
        message: "The capture id is not valid. Start again from the Recall page.".into(),
    })
}

fn canonical_id(value: &str) -> Result<String, ()> {
    let id = Uuid::parse_str(value.trim()).map_err(|_| ())?;
    Ok(id.to_string())
}

fn photo_filename(filename: Option<&str>) -> String {
    let base = filename
        .unwrap_or("photo")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("photo")
        .trim();
    if base.is_empty() || base.len() > 255 || base.contains(['\0', '/', '\\']) {
        "photo".into()
    } else {
        base.to_string()
    }
}

fn utf8_field(bytes: &[u8]) -> Result<String, FormError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| FormError {
        status: 400,
        message: "That field is not UTF-8.".into(),
    })
}

fn title_for(memory: &VaultMemory) -> String {
    title_from_note(&memory.note, "Untitled memory")
}

fn title_from_note(note: &str, fallback: &str) -> String {
    let note = note.trim();
    let (frontmatter, body) = if let Some(rest) = note.strip_prefix("---\n") {
        rest.split_once("\n---").unwrap_or(("", note))
    } else { ("", note) };
    if let Some(value) = frontmatter.lines().find_map(|line| line.strip_prefix("title: ")) {
        if let Ok(title) = serde_json::from_str::<String>(value) {
            if !title.trim().is_empty() { return title.chars().take(80).collect(); }
        }
    }
    let line = body.lines().find(|line| !line.trim().is_empty()).unwrap_or("").trim().trim_start_matches('#').trim();
    if line.is_empty() {
        return fallback.to_owned();
    }
    let mut title: String = line.chars().take(80).collect();
    if line.chars().count() > 80 { title.push('…'); }
    title
}

fn source_rel(memory: &VaultMemory) -> Option<String> {
    if memory.source_name.is_empty() {
        return None;
    }
    let ext = memory
        .source_name
        .rsplit('.')
        .next()
        .filter(|ext| !ext.is_empty() && ext.len() <= 8)?;
    Some(format!("Recall/Sources/{}.{ext}", memory.id))
}

fn note_rel(memory: &VaultMemory) -> String {
    let name = memory
        .note_path
        .as_deref()
        .filter(|name| {
            !name.is_empty()
                && name.ends_with(".md")
                && !name.contains(['/', '\\', '\0'])
                && *name != "."
                && *name != ".."
        })
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}.md", memory.id));
    format!("Recall/Memories/{name}")
}

fn esc(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

struct Part<'a> {
    name: &'a str,
    filename: Option<&'a str>,
    body: &'a [u8],
}

fn boundary(content_type: &str) -> Result<String, String> {
    let lower = content_type.to_ascii_lowercase();
    let index = lower
        .find("boundary=")
        .ok_or("The upload is missing its boundary.")?;
    let rest = content_type[index + "boundary=".len()..].trim();
    let raw = if let Some(quoted) = rest.strip_prefix('"') {
        quoted.split('"').next().unwrap_or("")
    } else {
        rest.split(';').next().unwrap_or("").trim()
    };
    if raw.is_empty()
        || raw.len() > 200
        || raw
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte == b'"')
    {
        return Err("The upload boundary is not valid.".into());
    }
    Ok(raw.to_string())
}

fn split_multipart<'a>(body: &'a [u8], boundary: &str) -> Result<Vec<Part<'a>>, String> {
    let marker = format!("--{boundary}");
    let marker = marker.as_bytes();
    let start = find_slice(body, marker).ok_or("The upload is incomplete.")?;
    let mut rest = &body[start + marker.len()..];
    let mut parts = Vec::new();
    loop {
        if rest.starts_with(b"--") {
            break;
        }
        if rest.starts_with(b"\r\n") {
            rest = &rest[2..];
        }
        let next = find_slice(rest, marker).ok_or("The upload is incomplete.")?;
        let mut part = &rest[..next];
        if part.ends_with(b"\r\n") {
            part = &part[..part.len() - 2];
        }
        parts.push(parse_part(part)?);
        if parts.len() > 8 {
            return Err("The form has too many fields.".into());
        }
        rest = &rest[next + marker.len()..];
    }
    Ok(parts)
}

fn parse_part(part: &[u8]) -> Result<Part<'_>, String> {
    let sep = find_slice(part, b"\r\n\r\n").ok_or("A form field is incomplete.")?;
    let headers = std::str::from_utf8(&part[..sep]).map_err(|_| "A form header is not UTF-8.")?;
    let body = &part[sep + 4..];
    let mut name = None;
    let mut filename = None;
    for line in headers.split("\r\n") {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.eq_ignore_ascii_case("content-disposition") {
            name = disposition_param(value, "name");
            filename = disposition_param(value, "filename");
        }
    }
    Ok(Part {
        name: name.ok_or("A form field is missing its name.")?,
        filename,
        body,
    })
}

fn disposition_param<'a>(header: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("{key}=");
    let index = header
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())?;
    let rest = &header[index + needle.len()..];
    if let Some(rest) = rest.strip_prefix('"') {
        let end = rest.find('"')?;
        Some(&rest[..end])
    } else {
        Some(rest.split(';').next()?.trim())
    }
}

fn find_slice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn form_value(body: &str, key: &str) -> Result<String, String> {
    for pair in body.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        if url_decode(raw_key)? == key {
            return url_decode(raw_value);
        }
    }
    Ok(String::new())
}

fn url_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                    .map_err(|_| "The question encoding is not valid.".to_string())?;
                let value = u8::from_str_radix(hex, 16)
                    .map_err(|_| "The question encoding is not valid.".to_string())?;
                out.push(value);
                index += 3;
            }
            b'%' => return Err("The question encoding is not valid.".into()),
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| "The question is not UTF-8.".into())
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn allow_all_interfaces() -> bool {
    matches!(
        std::env::var("RECALL_PHONE_ALLOW_ALL_INTERFACES")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("1") | Some("true")
    )
}

fn port_from_env() -> Result<u16, String> {
    let Some(value) = env_nonempty("RECALL_PHONE_PORT") else {
        return Ok(DEFAULT_PORT);
    };
    let port: u16 = value
        .parse()
        .map_err(|_| "RECALL_PHONE_PORT must be a number from 1 to 65535.".to_string())?;
    if port == 0 {
        return Err("RECALL_PHONE_PORT must be a number from 1 to 65535.".into());
    }
    Ok(port)
}

fn selection_file_from_env() -> Result<Option<PathBuf>, String> {
    if env_nonempty("RECALL_VAULT_DIR").is_some() {
        return Ok(None);
    }
    if let Some(explicit) = env_nonempty("RECALL_PHONE_SELECTION_FILE") {
        return Ok(Some(PathBuf::from(explicit)));
    }
    Ok(Some(desktop_selection_file()?))
}

fn desktop_selection_file() -> Result<PathBuf, String> {
    let id = "com.example.recall.desktop";
    #[cfg(windows)]
    {
        let base = std::env::var_os("APPDATA").ok_or("APPDATA is unset.")?;
        return Ok(PathBuf::from(base).join(id).join("selected-vault.json"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is unset.")?;
        return Ok(PathBuf::from(home)
            .join("Library/Application Support")
            .join(id)
            .join("selected-vault.json"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
            .ok_or("HOME is unset.")?;
        Ok(base.join(id).join("selected-vault.json"))
    }
}

fn resolve_vault_root(
    env_dir: Option<&str>,
    selection_file: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(value) = env_dir.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("RECALL_VAULT_DIR must be an absolute path.".into());
        }
        if !path.is_dir() {
            return Err(
                "RECALL_VAULT_DIR must already exist. Choose that folder in the desktop app, or create it, before starting the phone companion.".into(),
            );
        }
        return Ok(path);
    }
    let Some(path) = selection_file else {
        return Err(missing_vault());
    };
    if !path.is_file() {
        return Err(format!(
            "{}. The desktop selection file was not found at {}.",
            missing_vault(),
            path.display()
        ));
    }
    let bytes = std::fs::read(path).map_err(|err| err.to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("The desktop vault selection file is too large.".into());
    }
    let parsed: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "The desktop vault selection file is not valid JSON.".to_string())?;
    let root = parsed
        .get("root")
        .and_then(|value| value.as_str())
        .ok_or("The desktop vault selection file has no folder.")?;
    let expected = parsed
        .get("vault_identity")
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("vault_id").and_then(|value| value.as_str()))
        .filter(|value| !value.is_empty())
        .ok_or("The desktop vault selection file has no vault id.")?;
    let root = PathBuf::from(root);
    if !root.is_absolute() || !root.is_dir() {
        return Err("The desktop vault folder is missing.".into());
    }
    let vault = Vault::open(&root)?;
    if vault.id != expected {
        return Err("The desktop vault identity does not match the selection file. Choose the folder again in the desktop app.".into());
    }
    Ok(root)
}

fn missing_vault() -> String {
    "Set RECALL_VAULT_DIR to the same absolute folder the desktop app uses, or open a vault in the desktop app first.".into()
}

fn decide_bind(
    explicit: Option<&str>,
    allow_all_interfaces: bool,
    port: u16,
    detected_tailscale: Option<IpAddr>,
) -> Result<BindChoice, String> {
    let explicit = explicit.map(str::trim).filter(|value| !value.is_empty());
    let (ip, mode) = match explicit {
        None => match detected_tailscale {
            Some(ip) => (ip, BindMode::Tailscale),
            None => (IpAddr::V4(Ipv4Addr::LOCALHOST), BindMode::Loopback),
        },
        Some("tailscale") => {
            let ip = detected_tailscale.ok_or(
                "RECALL_PHONE_BIND=tailscale needs `tailscale ip -4` to succeed on this computer.",
            )?;
            (ip, BindMode::Tailscale)
        }
        Some("loopback" | "localhost" | "127.0.0.1") => {
            (IpAddr::V4(Ipv4Addr::LOCALHOST), BindMode::Loopback)
        }
        Some(value) => {
            let ip: IpAddr = value.parse().map_err(|_| {
                "RECALL_PHONE_BIND must be an IP address, tailscale, or loopback. Hostnames are not accepted.".to_string()
            })?;
            if ip.is_unspecified() {
                if !allow_all_interfaces {
                    return Err(
                        "Refusing to listen on every interface. Set RECALL_PHONE_BIND to the Tailscale IPv4 from `tailscale ip -4`, or set RECALL_PHONE_ALLOW_ALL_INTERFACES=1 only when no public interface can reach this port.".into(),
                    );
                }
                (ip, BindMode::AllInterfaces)
            } else if ip.is_loopback() {
                (ip, BindMode::Loopback)
            } else {
                (ip, BindMode::Explicit)
            }
        }
    };
    Ok(BindChoice {
        addr: SocketAddr::new(ip, port),
        mode,
    })
}

fn detect_tailscale_command() -> Option<IpAddr> {
    let output = Command::new("tailscale").args(["ip", "-4"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    detect_tailscale_ipv4(&text)
}

fn detect_tailscale_ipv4(stdout: &str) -> Option<IpAddr> {
    stdout.lines().find_map(|line| match line.trim().parse() {
        Ok(IpAddr::V4(ip)) => Some(IpAddr::V4(ip)),
        _ => None,
    })
}

fn startup_banner(root: &Path, vault_id: &str, choice: &BindChoice) -> String {
    let reach = match choice.mode {
        BindMode::Loopback => "Reach: this computer only. The phone cannot open this until Tailscale is running or you set RECALL_PHONE_BIND to this machine's tailnet IPv4.",
        BindMode::Tailscale => "Reach: this Tailscale address only. It is not a public bind. A Tailscale ACL should allow only your phone to open this port. Anyone on the tailnet who can open it can read and write the vault.",
        BindMode::Explicit => "Reach: the address you set. If it is not a Tailscale address, this port is exposed on that network. Do not forward it to the public internet.",
        BindMode::AllInterfaces => "Reach: every network interface. Tailscale ACLs do not protect a LAN or public address. Do not use this if any interface is reachable from a network you do not trust.",
    };
    format!(
        "Recall phone companion\nVault: {}\nVault id: {vault_id}\nOpen: {}\n{reach}\nNo login page. No API key in the page. Answer requests use the configured local service only after separate desktop consent; the phone does not call providers directly.\nHTTPS certificates and an offline phone queue are not provided.",
        root.display(),
        http_url(choice.addr)
    )
}

fn http_url(addr: SocketAddr) -> String {
    match addr.ip() {
        IpAddr::V4(ip) => format!("http://{ip}:{}/", addr.port()),
        IpAddr::V6(ip) => format!("http://[{ip}]:{}/", addr.port()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Read;
    use std::sync::Arc;
    use std::thread::JoinHandle;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("recall-phone-synthetic-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png() -> Vec<u8> {
        b"\x89PNG\r\n\x1a\nSYNTHETIC-TEST-ONLY".to_vec()
    }

    fn jpeg() -> Vec<u8> {
        let mut bytes = b"\xff\xd8\xffSYNTHETIC-TEST-ONLY".to_vec();
        bytes.extend_from_slice(b"\xff\xd9");
        bytes
    }

    fn text(response: &PhoneResponse) -> String {
        String::from_utf8(response.body.clone()).unwrap()
    }

    fn call(
        root: &Path,
        method: &str,
        target: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> PhoneResponse {
        handle(
            root,
            &PhoneRequest {
                method,
                target,
                headers,
                body,
            },
        )
    }

    #[test]
    fn processing_failure_does_not_deny_saved_capture() {
        let response = saved_processing_error("saved-id", "Metadata unavailable <unsafe>");
        let body = String::from_utf8(response.body).unwrap();
        assert!(body.contains("Capture saved; processing stopped"));
        assert!(body.contains("&lt;unsafe&gt;"));
        assert!(!body.contains("Nothing new was written"));
    }
    #[test]
    fn phone_answer_form_escapes_values_and_never_changes_consent() {
        let form = answer_form(
            "<script>alert(1)</script>",
            "00000000-0000-4000-8000-000000000001",
            "<img src=x>",
        );
        assert!(form.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(form.contains("&lt;img src=x&gt;"));
        assert!(!form.contains("<script>"));
        assert!(!form.contains("<img"));
        assert!(!form.contains("consent"));

        let dir = TempDir::new();
        let response = call(
            &dir.0,
            "POST",
            "/answer",
            &[("content-type", "application/x-www-form-urlencoded")],
            format!("q=hello&request_id={}", Uuid::new_v4()).as_bytes(),
        );
        assert_eq!(response.status, 200, "{}", text(&response));
        let body = text(&response);
        assert!(body.contains("Model answers are unavailable"));
        assert!(!body.contains("<script>"));
        assert!(body.contains("Search notes"));
    }

    #[test]
    fn phone_answer_rejects_cross_site_and_ambiguous_requests() {
        let dir = TempDir::new();
        let denied = call(
            &dir.0,
            "POST",
            "/answer",
            &[("host", "127.0.0.1:8787"), ("origin", "https://evil.example")],
            b"q=hello&request_id=00000000-0000-4000-8000-000000000001",
        );
        assert_eq!(denied.status, 403);
        assert!(!dir.0.join("Recall").exists());

        let duplicate = read_answer_request(&PhoneRequest {
            method: "POST", target: "/answer", headers: &[("content-type", "application/x-www-form-urlencoded")],
            body: b"q=one&q=two&request_id=00000000-0000-4000-8000-000000000001",
        }).unwrap_err();
        assert!(duplicate.message.contains("duplicate q"));
        let invalid_uuid = read_answer_request(&PhoneRequest {
            method: "POST", target: "/answer", headers: &[("content-type", "application/x-www-form-urlencoded")],
            body: b"q=one&request_id=not-a-uuid",
        }).unwrap_err();
        assert!(invalid_uuid.message.contains("request ID is invalid"));
    }

    #[test]
    fn phone_answer_revalidates_captured_text_using_native_source_snapshot_hash() {
        let dir = TempDir::new();
        let vault = Vault::open(&dir.0).unwrap();
        let note = "Project Aurora is led by Alice Chen.";
        let memory = vault.capture_note(&Uuid::new_v4().to_string(), note).unwrap();
        let snapshot = vault.processing_snapshot(&memory.id, memory.revision).unwrap();
        let source = vault.source(&memory.id).unwrap();
        assert_eq!(memory.source_sha256, hex::encode(Sha256::digest(b"")));
        assert_ne!(memory.source_sha256, source.sha256);
        assert_eq!(snapshot.source.sha256, source.sha256);

        let selection = crate::knowledge::AnswerSelection {
            source_id: memory.id.clone(),
            revision: memory.revision,
            source_sha256: source.sha256.clone(),
            note_sha256: hex::encode(Sha256::digest(note.as_bytes())),
            quote: "Project Aurora is led by Alice Chen.".into(),
        };
        let verified = verify_answer_sources(&vault, std::slice::from_ref(&selection))
            .expect("current text capture should verify against its immutable native source");
        assert_eq!(verified[0].source_sha256, source.sha256);

        let answer = crate::knowledge::MemoryAnswer {
            sources: crate::memory_query::Answer {
                question: "Who works on Project Aurora?".into(),
                message: "Local match found.".into(),
                hits: Vec::new(),
                knowledge_status: None,
                graph_relationships: Vec::new(),
            },
            status: "supported".into(),
            message: "Selected exact passages from current notes.".into(),
            selections: vec![selection.clone()],
            answer_provider: Some("synthetic-test-provider".into()),
        };
        let rendered = render_memory_answer(answer, &verified);
        assert!(rendered.contains("Project Aurora is led by Alice Chen."));
        assert!(rendered.contains(&source.sha256));
        assert!(!rendered.contains("Status: stale"));

        let mut wrong_source_hash = selection;
        wrong_source_hash.source_sha256 = memory.source_sha256;
        assert!(verify_answer_sources(&vault, &[wrong_source_hash]).is_none());
    }

    #[test]
    fn consented_capture_receipt_survives_dispatched_writer_and_repeated_delivery() {
        let dir = TempDir::new(); let vault = Vault::open(&dir.0).unwrap();
        let id = Uuid::new_v4().to_string();
        let body = format!("operation_id={id}&note=Synthetic+authorized+capture&process_consent=true");
        let headers = [("content-type", "application/x-www-form-urlencoded"), ("accept", "application/json"), ("x-recall-library-id", vault.id.as_str())];
        let request = PhoneRequest { method: "POST", target: "/capture", headers: &headers, body: body.as_bytes() };
        let writer = std::cell::RefCell::new(None);
        for rejected_dispatch in [false, true] {
            let response = capture_with(&dir.0, &request, &|v, intent| {
                // Permission is durable before any worker may take the writer.
                assert_eq!(serde_json::to_vec(&crate::companion_processing::recoverable(v, &id).unwrap()).unwrap(), serde_json::to_vec(&intent).unwrap());
                writer.replace(Some(v.lock()?));
                if rejected_dispatch { Err("Synthetic worker capacity reached".into()) } else { Ok(()) }
            });
            assert_eq!(response.status, 200);
            let receipt: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
            assert_eq!(receipt["memory_id"], id); assert_eq!(receipt["state"], "received");
            drop(writer.take());
            assert_eq!(receipt["source_sha256"], vault.source(&id).unwrap().sha256);
        }
        assert_eq!(vault.history(&id).unwrap().len(), 1);
        assert_eq!(vault.list_with_deleted("", false).unwrap().len(), 1);
    }
    #[test]
    fn queued_capture_requires_matching_library_and_returns_durable_receipt() {
        let dir = TempDir::new();
        let vault = Vault::open(&dir.0).unwrap();
        let id = Uuid::new_v4().to_string();
        let body = format!("operation_id={id}&note=Synthetic+offline+memory");
        let headers = [
            ("content-type", "application/x-www-form-urlencoded"),
            ("accept", "application/json"),
            ("x-recall-library-id", "wrong-library"),
        ];
        assert_eq!(
            call(&dir.0, "POST", "/capture", &headers, body.as_bytes()).status,
            409
        );
        assert!(vault.list_with_deleted("", false).unwrap().is_empty());
        let headers = [
            ("content-type", "application/x-www-form-urlencoded"),
            ("accept", "application/json"),
            ("x-recall-library-id", vault.id.as_str()),
        ];
        for _ in 0..2 {
            let response = call(&dir.0, "POST", "/capture", &headers, body.as_bytes());
            assert_eq!(response.status, 200);
            let receipt: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
            assert_eq!(receipt["memory_id"], id);
            assert_eq!(receipt["library_id"], vault.id);
            assert_eq!(receipt["state"], "received");
            assert_eq!(receipt["source_sha256"], vault.source(&id).unwrap().sha256);
        }
        assert_eq!(
            Vault::open(&dir.0)
                .unwrap()
                .list_with_deleted("", false)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn companion_scope_and_assets_are_available_without_private_cache() {
        let dir = TempDir::new();
        let vault = Vault::open(&dir.0).unwrap();
        let response = call(&dir.0, "GET", "/companion/library", &[], b"");
        assert_eq!(response.status, 200);
        let identity: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(identity["library_id"], vault.id);
        for path in ["/companion.js", "/companion-sw.js"] {
            let response = call(&dir.0, "GET", path, &[], b"");
            assert_eq!(response.status, 200);
            assert!(response.content_type.contains("javascript"));
        }
    }
    #[test]
    fn processing_recovery_requires_existing_consent_and_the_same_library() {
        let dir = TempDir::new();
        let vault = Vault::open(&dir.0).unwrap();
        let memory = vault
            .capture_note(
                &Uuid::new_v4().to_string(),
                "Synthetic pending interpretation?",
            )
            .unwrap();
        let url = format!("/processing/{}/resume", memory.id);
        let headers = [("content-type", "application/x-www-form-urlencoded")];
        let body = format!("library_id={}", vault.id);
        assert_eq!(
            call(&dir.0, "POST", &url, &headers, body.as_bytes()).status,
            403
        );
        crate::companion_processing::consent(&vault, &memory, true).unwrap();
        assert_eq!(
            call(&dir.0, "POST", &url, &headers, b"library_id=another").status,
            409
        );
        let page = text(&call(
            &dir.0,
            "GET",
            &format!("/saved/{}", memory.id),
            &[],
            b"",
        ));
        assert!(page.contains("Resume previously authorized processing"));
        vault
            .correct(
                &memory.id,
                1,
                &Uuid::new_v4().to_string(),
                "Human correction",
            )
            .unwrap();
        assert_eq!(
            call(&dir.0, "POST", &url, &headers, body.as_bytes()).status,
            403
        );
        assert_eq!(vault.history(&memory.id).unwrap().len(), 2);
    }

    #[test]
    fn saved_view_recovers_from_brief_processing_writer_contention() {
        let dir = TempDir::new();
        let vault = Vault::open(&dir.0).unwrap();
        let memory = vault
            .capture_note(&Uuid::new_v4().to_string(), "Synthetic recoverable view")
            .unwrap();
        let lock = vault.lock().unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            drop(lock);
        });
        let response = call(&dir.0, "GET", &format!("/saved/{}", memory.id), &[], b"");
        release.join().unwrap();
        assert_eq!(response.status, 200);
        assert!(text(&response).contains("Synthetic recoverable view"));
    }

    #[test]
    fn bind_defaults_to_loopback_and_refuses_every_interface() {
        let choice = decide_bind(None, false, 8787, None).unwrap();
        assert_eq!(choice.addr, "127.0.0.1:8787".parse().unwrap());
        assert_eq!(choice.mode, BindMode::Loopback);
        assert!(!choice.addr.ip().is_unspecified());

        let tailnet = decide_bind(None, false, 8787, Some("100.64.1.5".parse().unwrap())).unwrap();
        assert_eq!(tailnet.addr, "100.64.1.5:8787".parse().unwrap());
        assert_eq!(tailnet.mode, BindMode::Tailscale);

        let refused = decide_bind(Some("0.0.0.0"), false, 8787, None).unwrap_err();
        assert!(refused.contains("Refusing to listen on every interface"));
        let allowed = decide_bind(Some("0.0.0.0"), true, 8787, None).unwrap();
        assert_eq!(allowed.mode, BindMode::AllInterfaces);
        assert!(decide_bind(Some("nick-pc.tailnet.ts.net"), false, 8787, None).is_err());
        assert!(decide_bind(Some("tailscale"), false, 8787, None).is_err());
    }

    #[test]
    fn tailscale_output_uses_the_first_ipv4() {
        assert_eq!(
            detect_tailscale_ipv4("100.64.8.8\nfd7a:115c:a1e0::1\n"),
            Some("100.64.8.8".parse().unwrap())
        );
        assert_eq!(detect_tailscale_ipv4("not-an-address\n"), None);
    }

    #[test]
    fn vault_dir_must_be_absolute_and_selection_must_match() {
        let missing = TempDir::new();
        let absent = missing.0.join("nope");
        assert!(resolve_vault_root(Some("relative/vault"), None).is_err());
        assert!(resolve_vault_root(Some(absent.to_str().unwrap()), None).is_err());

        let dir = TempDir::new();
        let opened = resolve_vault_root(Some(dir.0.to_str().unwrap()), None).unwrap();
        assert_eq!(opened, dir.0);

        let selected = TempDir::new();
        let vault = Vault::open(&selected.0).unwrap();
        let settings = selected.0.join("selected-vault.json");
        fs::write(
            &settings,
            serde_json::json!({
                "root": selected.0,
                "vault_id": vault.id,
                "vault_identity": vault.id
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            resolve_vault_root(None, Some(&settings)).unwrap(),
            selected.0
        );
        fs::write(
            &settings,
            serde_json::json!({
                "root": selected.0,
                "vault_id": Uuid::new_v4(),
                "vault_identity": Uuid::new_v4()
            })
            .to_string(),
        )
        .unwrap();
        assert!(resolve_vault_root(None, Some(&settings)).is_err());
    }

    #[test]
    fn home_page_has_no_login_and_no_fixture_memories() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let response = call(&dir.0, "GET", "/", &[], b"");
        let page = text(&response);
        assert_eq!(response.status, 200);
        assert!(page.contains(KEYWORD_LABEL));
        assert!(page.contains("no account"));
        assert!(!page.to_lowercase().contains("password"));
        assert!(!page.to_lowercase().contains("sign in"));
        assert!(!page.to_lowercase().contains("sign-in"));
        assert!(!page.contains("type=\"email\""));
        assert!(!page.contains("Brooks Campus"));
        assert!(!page.contains("300MW"));
        assert!(page.contains("<script src=\"/companion.js\" defer></script>"));
    }

    #[test]
    fn startup_banner_describes_consent_gated_local_answer_service() {
        let dir = TempDir::new();
        let choice = BindChoice { addr: "127.0.0.1:8787".parse().unwrap(), mode: BindMode::Loopback };
        let banner = startup_banner(&dir.0, "synthetic-vault-id", &choice);
        assert!(banner.contains("No API key in the page."));
        assert!(banner.contains("configured local service only after separate desktop consent"));
        assert!(banner.contains("phone does not call providers directly"));
        assert!(banner.contains("HTTPS certificates and an offline phone queue are not provided"));
        assert!(!banner.contains("Claude is not called from this process"));
        assert!(!banner.contains("Claude-from-the-phone"));
    }

    #[test]
    fn phone_ask_escapes_inferred_facts_and_links_each_support() {
        let source_id = "00000000-0000-4000-8000-000000000001".to_string();
        let answer = crate::memory_query::Answer {
            question: "synthetic query".into(),
            message: "Related graph knowledge was found.".into(),
            hits: Vec::new(), knowledge_status: None,
            graph_relationships: vec![crate::knowledge::Relationship {
                id: "synthetic-rel".into(), source_id: source_id.clone(), revision: 1,
                source_sha256: "a".repeat(64), note_sha256: "b".repeat(64), source_name: "synthetic.txt".into(), note_path: "synthetic.md".into(),
                quote: "<script>support</script>".into(), subject_id: Uuid::new_v4().to_string(), subject: "<script>subject</script>".into(), subject_type: "person".into(),
                predicate: "works with".into(), object_id: Uuid::new_v4().to_string(), object: "<img src=x>".into(), object_type: "project".into(),
                fact: "<script>alert(1)</script>".into(), valid_at: None, invalid_at: None, extracted_at: "2026-10-12T00:00:00Z".into(), inferred: true,
                uncertainty: "unverified".into(), related_source_ids: vec![source_id.clone()], supports: vec![crate::knowledge::RelationshipSupport {
                    source_id: source_id.clone(), revision: 1, source_sha256: "a".repeat(64), note_sha256: "b".repeat(64), quote: "<script>support</script>".into()
                }],
            }],
        };
        let rendered = render_source_answer(answer);
        assert!(rendered.contains("Related inferred knowledge"));
        assert!(rendered.contains("Inferred and unverified"));
        assert!(rendered.contains(&format!("href=\"/sources/{source_id}\"")));
        assert!(rendered.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(rendered.contains("&lt;script&gt;support&lt;/script&gt;"));
        assert!(!rendered.contains("<script>") && !rendered.contains("<img src=x>"));
    }

    #[test]
    fn result_titles_use_source_text_and_readable_fallback() {
        assert_eq!(title_from_note("---\ntitle: \"A quiet afternoon\"\n---\nBody", "Fallback"), "A quiet afternoon");
        assert_eq!(title_from_note("# A human heading\nMore", "Fallback"), "A human heading");
        assert_eq!(title_from_note("  ", "Memory captured 2026-10-15"), "Memory captured 2026-10-15");
    }

    #[test]
    fn phone_ask_keeps_keyword_evidence_when_graph_search_is_unavailable() {
        let answer = crate::memory_query::Answer {
            question: "synthetic query".into(), message: "Local source matches remain available.".into(),
            hits: vec![crate::memory_query::Hit { memory_id: Uuid::new_v4().to_string(), revision: 1,
                note_basename: "synthetic.md".into(), current_excerpt: "<b>Local evidence</b>".into(),
                original_excerpt: "Synthetic original".into(), source_sha256: "c".repeat(64), mime_type: "text/plain".into(), match_reason: "Synthetic match".into(), linked_from_memory_id: None, original_start_byte: Some(0), original_end_byte: Some(18), captured_at: "2026-10-14".into(), updated_at: "2026-10-14".into(), human_corrected: false }],
            knowledge_status: Some(crate::knowledge::ServiceStatus { state:"unavailable".into(),pending:0,indexed:0,failed:0,message:"temporarily unavailable".into(),providers:None }),
            graph_relationships: Vec::new(),
        };
        let rendered = render_source_answer(answer);
        assert!(rendered.contains("Source-backed matches"));
        assert!(rendered.contains("<h2>&lt;b&gt;Local evidence&lt;/b&gt;</h2>"));
        assert!(!rendered.contains("<h2>synthetic.md</h2>"));
        assert!(rendered.contains("Original excerpt: bytes 0–18"));
        assert!(rendered.contains("Source verification"));
        assert!(rendered.contains("&lt;b&gt;Local evidence&lt;/b&gt;"));
        assert!(rendered.contains("Local keyword retrieval"));
        assert!(!rendered.contains("Related knowledge (inferred)"));
    }

    #[test]
    fn capture_writes_original_then_note_and_retry_is_idempotent() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let id = Uuid::new_v4().to_string();
        let boundary = "RecallSyntheticBoundary";
        let mut body = Vec::new();
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operation_id\"\r\n\r\n{id}\r\n").into_bytes());
        body.extend(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\n800 psi?\r\n"
            )
            .into_bytes(),
        );
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"C:\\\\DCIM\\\\page.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").into_bytes());
        body.extend(jpeg());
        body.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
        let save_started = std::time::Instant::now();
        let response = call(
            &dir.0,
            "POST",
            "/capture",
            &[(
                "content-type",
                &format!("multipart/form-data; boundary={boundary}"),
            )],
            &body,
        );
        assert!(save_started.elapsed() < std::time::Duration::from_secs(2), "capture save waited on the optional graph service");
        assert_eq!(response.status, 303, "{}", text(&response));
        assert_eq!(
            response
                .extra
                .iter()
                .find(|(name, _)| name == "Location")
                .map(|(_, value)| value.as_str()),
            Some(format!("/saved/{id}").as_str())
        );
        let source = dir.0.join(format!("Recall/Sources/{id}.jpg"));
        let note = dir.0.join(format!("Recall/Memories/{id}.md"));
        assert_eq!(fs::read(&source).unwrap(), jpeg());
        let markdown = fs::read_to_string(&note).unwrap();
        assert!(markdown.starts_with(&format!(
            "<!-- Recall memory {id} | human annotation, not OCR -->"
        )));
        assert!(markdown.contains(&format!("../Sources/{id}.jpg")));
        assert!(markdown.contains("800 psi?"));
        assert!(!dir.0.join("page.jpg").exists());
        assert!(!dir.0.join("DCIM").exists());

        let again = call(
            &dir.0,
            "POST",
            "/capture",
            &[(
                "content-type",
                &format!("multipart/form-data; boundary={boundary}"),
            )],
            &body,
        );
        assert_eq!(again.status, 303);
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Sources")).unwrap().count(),
            1
        );

        body.clear();
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operation_id\"\r\n\r\n{id}\r\n").into_bytes());
        body.extend(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nchanged\r\n"
            )
            .into_bytes(),
        );
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"page.jpg\"\r\n\r\n").into_bytes());
        body.extend(jpeg());
        body.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
        let changed = call(
            &dir.0,
            "POST",
            "/capture",
            &[(
                "content-type",
                &format!("multipart/form-data; boundary={boundary}"),
            )],
            &body,
        );
        assert_eq!(changed.status, 400);
        assert!(text(&changed).contains("different payload"));
        assert!(fs::read_to_string(&note).unwrap().contains("800 psi?"));
    }

    #[test]
    fn processing_consent_is_explicit_and_duplicate_fields_are_rejected() {
        assert!(!header_consent(&[]).unwrap());
        assert!(header_consent(&[("X-Recall-Process-Consent", "true")]).unwrap());
        assert!(header_consent(&[
            ("x-recall-process-consent", "true"),
            ("X-Recall-Process-Consent", "false")
        ])
        .is_err());
        assert!(header_consent(&[("x-recall-process-consent", "yes")]).is_err());
        assert!(!form_consent("note=hello").unwrap());
        assert!(form_consent("process_consent=true").unwrap());
        assert!(form_consent("process_consent=true&process_consent=false").is_err());
        assert!(form_consent("process_consent=yes").is_err());
        let dir = TempDir::new();
        let id = Uuid::new_v4().to_string();
        let response = call(
            &dir.0,
            "POST",
            "/capture",
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("origin", "http://evil.example"),
                ("host", "127.0.0.1:8787"),
            ],
            format!("operation_id={id}&note=hello&process_consent=true").as_bytes(),
        );
        assert_eq!(response.status, 403);
        assert!(!dir.0.join("Recall").exists());
    }
    #[test]
    fn vague_phone_ask_returns_current_memory_and_original_hash() {
        let dir = TempDir::new();
        let v = Vault::open(&dir.0).unwrap();
        let m = v
            .capture_note(
                &Uuid::new_v4().to_string(),
                "Utility late. Call Sarah. Crossed out: 8 MW confirmed.",
            )
            .unwrap();
        let response = call(
            &dir.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=What+was+going+on+with+that+utility+delay%3F",
        );
        assert_eq!(response.status, 200);
        let page = text(&response);
        assert!(page.contains("Source-backed matches"));
        assert!(page.contains("Utility late."));
        assert!(page.contains(&v.source(&m.id).unwrap().sha256));
        assert!(page.contains(&format!("/sources/{}", m.id)));
        let original = call(&dir.0, "GET", &format!("/sources/{}", m.id), &[], b"");
        assert_eq!(original.status, 200);
        assert_eq!(original.content_type, "text/plain");
        assert!(text(&original).contains("Crossed out: 8 MW confirmed."));
    }
    #[test]
    fn text_only_note_preserves_original_source_and_ask_finds_it() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let home = text(&call(&dir.0, "GET", "/", &[], b""));
        assert!(home.contains("Photo or file, optional"));
        let photo_input = home.split("<input").find(|tag| tag.starts_with(" type=\"file\""))
            .unwrap().split('>').next().unwrap();
        assert!(photo_input.contains("name=\"photo\""));
        assert!(photo_input.contains("accept=\"image/png,image/jpeg,image/webp\""));
        assert!(photo_input.contains("capture=\"environment\""));
        assert!(!photo_input.contains("required"));

        let id = Uuid::new_v4().to_string();
        let boundary = "RecallSyntheticBoundary";
        let mut body = Vec::new();
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operation_id\"\r\n\r\n{id}\r\n").into_bytes());
        body.extend(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nMeet Pat at the pump house, uncertain?\r\n"
            )
            .into_bytes(),
        );
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"\"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n").into_bytes());
        body.extend(format!("--{boundary}--\r\n").into_bytes());
        let headers = [(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )];
        let response = call(
            &dir.0,
            "POST",
            "/capture",
            &[("content-type", headers[0].1.as_str())],
            &body,
        );
        assert_eq!(response.status, 303, "{}", text(&response));
        let note_path = dir.0.join(format!("Recall/Memories/{id}.md"));
        let markdown = fs::read_to_string(&note_path).unwrap();
        assert!(markdown.contains("No original photo."));
        assert!(markdown.contains("Meet Pat at the pump house, uncertain?"));
        assert!(!markdown.contains("../Sources/"));
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Sources")).unwrap().count(),
            1
        );
        let saved = text(&call(&dir.0, "GET", &format!("/saved/{id}"), &[], b""));
        assert!(saved.contains("original text is preserved"));
        assert!(saved.contains("Meet Pat at the pump house, uncertain?"));
        assert!(saved.contains("Original SHA-256"));
        assert!(!saved.contains("alt=\"Original page\""));
        assert!(!saved.contains("src=\"/sources/"));
        assert_eq!(
            call(&dir.0, "GET", &format!("/sources/{id}"), &[], b"").status,
            200
        );

        let again = call(
            &dir.0,
            "POST",
            "/capture",
            &[("content-type", headers[0].1.as_str())],
            &body,
        );
        assert_eq!(again.status, 303, "{}", text(&again));
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Memories")).unwrap().count(),
            1
        );
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Sources")).unwrap().count(),
            1
        );

        let ask = call(
            &dir.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=What+about+the+pump+house%3F",
        );
        let page = text(&ask);
        assert_eq!(ask.status, 200, "{page}");
        assert!(page.contains(KEYWORD_LABEL));
        assert!(page.contains("Meet Pat at the pump house, uncertain?"));
        assert!(page.contains("Original evidence"));
        assert!(page.contains(&format!("Recall/Memories/{id}.md")));
        assert!(page.contains(&format!("Recall/Sources/{id}.txt")));
        assert!(!page.contains("alt=\"Original page\""));
        assert!(!page.contains("<img src=\"/sources/"));
        assert!(page.contains(&format!("/sources/{id}")));

        let mut changed = Vec::new();
        changed.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operation_id\"\r\n\r\n{id}\r\n").into_bytes());
        changed.extend(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nchanged\r\n"
            )
            .into_bytes(),
        );
        changed.extend(format!("--{boundary}--\r\n").into_bytes());
        let rejected = call(
            &dir.0,
            "POST",
            "/capture",
            &[("content-type", headers[0].1.as_str())],
            &changed,
        );
        assert_eq!(rejected.status, 400, "{}", text(&rejected));
        assert!(fs::read_to_string(&note_path)
            .unwrap()
            .contains("uncertain?"));

        let blank = call(
            &dir.0,
            "POST",
            "/capture",
            &[("content-type", "application/x-www-form-urlencoded")],
            format!("operation_id={}&note=%20%20", Uuid::new_v4()).as_bytes(),
        );
        assert_eq!(blank.status, 400, "{}", text(&blank));
        assert!(text(&blank).contains("A photo is optional"));
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Memories")).unwrap().count(),
            1
        );
        assert_eq!(
            fs::read_dir(dir.0.join("Recall/Sources")).unwrap().count(),
            1
        );

        let edited = fs::read_to_string(&note_path)
            .unwrap()
            .replace("uncertain?", "Notepad kept this?");
        fs::write(&note_path, &edited).unwrap();
        let edited_ask = text(&call(
            &dir.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=Notepad",
        ));
        assert!(edited_ask.contains("Notepad kept this?"));
        assert!(edited_ask.contains(&format!("Recall/Sources/{id}.txt")));
        assert_eq!(fs::read_to_string(&note_path).unwrap(), edited);
    }

    #[test]
    fn ask_cites_the_vault_and_keeps_a_local_edit() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let id = Uuid::new_v4().to_string();
        let saved = call(
            &dir.0,
            "POST",
            "/capture",
            &[
                ("content-type", "image/png"),
                ("x-recall-operation-id", &id),
                ("x-recall-note", "Brooks pump house, uncertain?"),
            ],
            &png(),
        );
        assert_eq!(saved.status, 303, "{}", text(&saved));
        let note_path = dir.0.join(format!("Recall/Memories/{id}.md"));
        let edited = fs::read_to_string(&note_path)
            .unwrap()
            .replace("uncertain?", "Notepad kept this?");
        fs::write(&note_path, &edited).unwrap();

        let ask = call(
            &dir.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=What+do+you+know+about+Notepad%3F",
        );
        let page = text(&ask);
        assert_eq!(ask.status, 200, "{page}");
        assert!(page.contains(KEYWORD_LABEL));
        assert!(page.contains("not a generated answer"));
        assert!(page.contains("Notepad kept this?"));
        assert!(page.contains(&format!("/sources/{id}")));
        assert!(page.contains(&format!("Recall/Memories/{id}.md")));
        assert!(page.contains(&format!("Recall/Sources/{id}.png")));
        assert_eq!(fs::read_to_string(&note_path).unwrap(), edited);
        assert_eq!(
            fs::read(dir.0.join(format!("Recall/Sources/{id}.png"))).unwrap(),
            png()
        );

        let miss = call(
            &dir.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=xylophone+quantum",
        );
        assert!(text(&miss).contains("Nothing in the notes or related knowledge matches"));
        assert!(text(&miss).contains("not a generated answer"));

        let fresh = TempDir::new();
        Vault::open(&fresh.0).unwrap();
        let no_fixture = call(
            &fresh.0,
            "POST",
            "/ask",
            &[("content-type", "application/x-www-form-urlencoded")],
            b"q=Brooks+Campus",
        );
        assert!(text(&no_fixture).contains("Nothing in the notes or related knowledge matches"));
        assert!(!text(&no_fixture).contains("300MW"));
    }

    #[test]
    fn cross_site_post_does_not_write_and_paths_stay_inside_sources() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let refused = call(
            &dir.0,
            "POST",
            "/capture",
            &[
                ("host", "127.0.0.1:8787"),
                ("origin", "https://evil.example"),
                ("sec-fetch-site", "cross-site"),
                ("content-type", "image/png"),
            ],
            &png(),
        );
        assert_eq!(refused.status, 403);
        assert!(!dir
            .0
            .join("Recall/Sources")
            .read_dir()
            .unwrap()
            .next()
            .is_some());
        let file_upload = call(
            &dir.0,
            "POST",
            "/capture",
            &[
                ("host", "127.0.0.1:8787"),
                ("origin", "null"),
                ("sec-fetch-site", "same-origin"),
                ("content-type", "image/png"),
                ("x-recall-operation-id", &Uuid::new_v4().to_string()),
                ("x-recall-note", "file upload"),
            ],
            &png(),
        );
        assert_eq!(file_upload.status, 303, "{}", text(&file_upload));

        let id = Uuid::new_v4().to_string();
        let saved = call(
            &dir.0,
            "POST",
            "/capture",
            &[
                ("host", "127.0.0.1:8787"),
                ("origin", "http://127.0.0.1:8787"),
                ("sec-fetch-site", "same-origin"),
                ("content-type", "image/png"),
                ("x-recall-operation-id", &id),
                ("x-recall-note", "<script>alert(1)</script>"),
            ],
            &png(),
        );
        assert_eq!(saved.status, 303);
        let page = call(&dir.0, "GET", &format!("/saved/{id}"), &[], b"");
        let html = text(&page);
        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<script>alert"));
        let original = call(&dir.0, "GET", &format!("/sources/{id}"), &[], b"");
        assert_eq!(original.status, 200);
        assert_eq!(original.body, png());
        assert_eq!(original.content_type, "image/png");
        assert_eq!(
            call(&dir.0, "GET", "/sources/../../etc/passwd", &[], b"").status,
            404
        );
        assert_eq!(
            call(&dir.0, "GET", "/sources/not-an-id", &[], b"").status,
            404
        );
        let leaked = call(&dir.0, "GET", "/ask?q=secret-word", &[], b"");
        assert_eq!(leaked.status, 405);
        assert!(!text(&leaked).contains("secret-word"));
    }

    #[test]
    fn limiter_stops_the_thirty_first_capture_in_a_minute() {
        let mut limiter = WindowLimiter::new(30);
        let now = Instant::now();
        for _ in 0..30 {
            assert!(limiter.allow(now));
        }
        assert!(!limiter.allow(now));
        assert!(limiter.allow(now + Duration::from_secs(60)));
    }

    struct Running {
        addr: SocketAddr,
        server: Arc<tiny_http::Server>,
        thread: Option<JoinHandle<()>>,
    }

    impl Running {
        fn spawn(root: PathBuf) -> Self {
            let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
            let addr = server.server_addr().to_ip().unwrap();
            let server = Arc::new(server);
            let background = Arc::clone(&server);
            let thread = std::thread::spawn(move || {
                let mut captures = WindowLimiter::new(u32::MAX);
                let mut asks = WindowLimiter::new(u32::MAX);
                for request in background.incoming_requests() {
                    let _ = serve_one(&root, &mut captures, &mut asks, request);
                }
            });
            Self {
                addr,
                server,
                thread: Some(thread),
            }
        }
    }

    impl Drop for Running {
        fn drop(&mut self) {
            self.server.unblock();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    #[test]
    fn http_server_on_loopback_saves_and_serves_the_original() {
        let dir = TempDir::new();
        Vault::open(&dir.0).unwrap();
        let running = Running::spawn(dir.0.clone());
        let agent = ureq::AgentBuilder::new().redirects(0).build();
        let id = Uuid::new_v4().to_string();
        let mut response = None;
        for _ in 0..50 {
            match agent
                .post(&format!("http://{}/capture", running.addr))
                .set("Content-Type", "image/png")
                .set("X-Recall-Operation-Id", &id)
                .set("X-Recall-Note", "synthetic page")
                .send_bytes(&png())
            {
                Ok(ok) => {
                    response = Some(ok);
                    break;
                }
                Err(_) => std::thread::sleep(Duration::from_millis(20)),
            }
        }
        let response = response.expect("phone companion did not accept a capture");
        assert_eq!(response.status(), 303);
        assert_eq!(
            response.header("Location"),
            Some(format!("/saved/{id}").as_str())
        );
        let page = ureq::get(&format!("http://{}/saved/{id}", running.addr))
            .call()
            .unwrap()
            .into_string()
            .unwrap();
        assert!(page.contains("Saved in the desktop vault"));
        assert!(page.contains("No resumable source-specific processing authorization"));
        let response = ureq::get(&format!("http://{}/sources/{id}", running.addr))
            .call()
            .unwrap();
        let mut original = Vec::new();
        response.into_reader().read_to_end(&mut original).unwrap();
        assert_eq!(original, png());
    }
}
