//! Native coordinator for the optional, derived local Graphiti index.
//! The Obsidian vault remains authoritative; every returned citation is rebound
//! to the current native note before it crosses the Tauri boundary.
use crate::local_vault::{KnowledgeControl, Vault};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet, HashMap}, sync::{mpsc::{sync_channel, SyncSender, TrySendError}, Arc, Mutex, OnceLock}, time::Duration};
use ureq::{Agent, AgentBuilder};

const MAX_SNAPSHOT: usize = 16 * 1024 * 1024;
const MAX_SOURCES: usize = 10_000;
const MAX_TEXT: usize = 256 * 1024;
const MAX_QUERY: usize = 4096;
const MAX_LIMIT: usize = 50;
const MAX_ANSWER_CANDIDATES: usize = 8;

type Result<T> = std::result::Result<T, String>;
fn sha(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }
fn validate_request_id(request_id: &str) -> Result<()> {
    let request_uuid = uuid::Uuid::parse_str(request_id).map_err(|_| "Answer request ID must be a UUID")?;
    if request_uuid.to_string() != request_id { return Err("Answer request ID must be a canonical UUID".into()); }
    Ok(())
}
static SCOPE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
fn with_scope_lock<T>(scope: &str, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let locks = SCOPE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let lock = {
        let mut locks = locks.lock().map_err(|_| "Local knowledge coordinator is unavailable")?;
        locks.entry(scope.to_owned()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    };
    let _guard = lock.lock().map_err(|_| "Local knowledge coordinator is unavailable")?;
    operation()
}
struct RefreshEntry { vault: Vault, dirty: bool }
struct RefreshWorker { sender: SyncSender<String>, entries: Arc<Mutex<HashMap<String, RefreshEntry>>> }
static REFRESH_WORKER: OnceLock<RefreshWorker> = OnceLock::new();
fn refresh_worker() -> &'static RefreshWorker {
    REFRESH_WORKER.get_or_init(|| {
        let (sender, receiver) = sync_channel::<String>(32);
        let entries = Arc::new(Mutex::new(HashMap::<String, RefreshEntry>::new()));
        let worker_entries = entries.clone();
        std::thread::spawn(move || {
            while let Ok(scope) = receiver.recv() {
                // Let the just-completed capture return and immediate read-after-
                // write pages finish before the advisory index touches the vault.
                std::thread::sleep(Duration::from_millis(250));
                loop {
                    let vault = match worker_entries.lock().ok().and_then(|mut rows| rows.get_mut(&scope).map(|row| {
                        row.dirty = false; row.vault.clone()
                    })) { Some(vault) => vault, None => break };
                    let _ = refresh(&vault);
                    let mut rows = match worker_entries.lock() { Ok(rows) => rows, Err(_) => break };
                    match rows.get(&scope) {
                        Some(row) if row.dirty => continue,
                        Some(_) => { rows.remove(&scope); break; }
                        None => break,
                    }
                }
            }
        });
        RefreshWorker { sender, entries }
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderDisclosure { pub extraction: String, pub embedding: String, pub reranking: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceStatus { pub state: String, pub pending: u64, pub indexed: u64, pub failed: u64, pub message: String, #[serde(default)] pub providers: Option<ProviderDisclosure> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationshipSupport { pub source_id: String, pub revision: u64, pub source_sha256: String, pub note_sha256: String, pub quote: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relationship {
    pub id: String, pub source_id: String, pub revision: u64, pub source_sha256: String,
    pub note_sha256: String, pub source_name: String, pub note_path: String, pub quote: String,
    pub subject_id: String, pub subject: String, pub subject_type: String, pub predicate: String, pub object_id: String, pub object: String,
    pub object_type: String, pub fact: String, pub valid_at: Option<String>, pub invalid_at: Option<String>,
    pub extracted_at: String, pub inferred: bool, pub uncertainty: String,
    pub related_source_ids: Vec<String>, pub supports: Vec<RelationshipSupport>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchReply { pub status: ServiceStatus, pub relationships: Vec<Relationship> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KnowledgeStatus { pub enabled: bool, pub include_existing: bool, pub generation: u64, pub service: ServiceStatus, pub provider_disclosure: String, pub providers: Option<ProviderDisclosure>, pub answer_enabled: bool, pub answer_provider: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    id: String, revision: u64, source_sha256: String, note_sha256: String, text: String,
    source_name: String, note_path: String, captured_at: String, updated_at: String,
}
#[derive(Serialize)]
struct SnapshotRequest<'a> {
    version: u32, scope: &'a str, generation: u64, processing_allowed: bool, answer_allowed: bool, answer_provider: &'a str,
    sources: &'a [Source], eligible_ids: &'a [String], suppressed_facts: &'a BTreeSet<String>, rebuild: bool,
}
#[derive(Serialize)]
struct SearchRequest<'a> { version: u32, scope: &'a str, generation: u64, query: &'a str, limit: usize, include_history: bool }
#[derive(Serialize)]
struct AnswerRequest<'a> { version: u32, scope: &'a str, generation: u64, request_id: &'a str, question: &'a str, candidate_ids: &'a [String] }
#[derive(Serialize)]
struct CancelAnswerRequest<'a> { version: u32, scope: &'a str, generation: u64, request_id: &'a str }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnswerSelection { pub source_id: String, pub revision: u64, pub source_sha256: String, pub note_sha256: String, pub quote: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AnswerReply { status: String, selections: Vec<AnswerSelection>, message: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelReply { cancelled: bool }
#[derive(Serialize)]
pub struct MemoryAnswer { pub sources: crate::memory_query::Answer, pub status: String, pub message: String, pub selections: Vec<AnswerSelection>, pub answer_provider: Option<String> }
#[derive(Clone)]
struct ActiveAnswer { scope: String, generation: u64, dispatched: bool }
#[derive(Clone)]
pub struct AnswerStart { pub allowed: bool, pub replaced: Option<(String, u64)> }
static ACTIVE_ANSWERS: OnceLock<Mutex<HashMap<String, ActiveAnswer>>> = OnceLock::new();

#[derive(Clone)]
pub struct Client { base: String, token: String, agent: Agent }
impl Client {
    pub fn from_env() -> Result<Self> {
        let base = std::env::var("RECALL_GRAPH_URL").unwrap_or_else(|_| "http://127.0.0.1:8766".into());
        let host = base.strip_prefix("http://127.0.0.1:").ok_or("Graph service URL must use HTTP loopback 127.0.0.1")?;
        if host.is_empty() || host.contains('/') || host.contains('@') || host.contains('#') || host.contains('?')
            || host.parse::<u16>().ok().filter(|port| *port != 0).is_none() {
            return Err("Graph service URL must be a fixed 127.0.0.1 host and port".into());
        }
        let token = std::env::var("RECALL_GRAPH_TOKEN").map_err(|_| "Local graph service is not configured")?;
        if token.as_bytes().len() < 32 || token.chars().any(char::is_control) { return Err("Local graph service credential is invalid".into()); }
        Ok(Self { base, token, agent: AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(1)).timeout_read(Duration::from_secs(4)).timeout_write(Duration::from_secs(4)).build() })
    }
    fn post<T: for<'de> Deserialize<'de> + StatusEnvelope>(&self, path: &str, value: &impl Serialize, max: usize) -> Result<T> {
        let body = serde_json::to_vec(value).map_err(|_| "Could not encode local knowledge request")?;
        if body.len() > max { return Err("Local knowledge request exceeds its size limit".into()); }
        let response = self.agent.post(&format!("{}{path}", self.base)).set("Authorization", &format!("Bearer {}", self.token))
            .set("Content-Type", "application/json").send_bytes(&body).map_err(|_| "Local graph service request failed")?;
        if response.status() != 200 { return Err("Local graph service is unavailable".into()); }
        let mut bytes = Vec::new(); response.into_reader().take((max + 1) as u64).read_to_end(&mut bytes).map_err(|_| "Local graph service response could not be read")?;
        if bytes.len() > max { return Err("Local graph service response exceeds its size limit".into()); }
        let mut decoded: T = serde_json::from_slice(&bytes).map_err(|_| "Local graph service response is invalid".to_owned())?;
        if let Some(status) = any_status_mut(&mut decoded) { normalize_status(status)?; }
        Ok(decoded)
    }
    pub fn health(&self) -> Result<ServiceStatus> {
        let response = self.agent.get(&format!("{}/v1/health", self.base)).set("Authorization", &format!("Bearer {}", self.token))
            .call().map_err(|_| "Local graph service is unavailable")?;
        if response.status() != 200 { return Err("Local graph service is unavailable".into()); }
        let mut bytes = Vec::new(); response.into_reader().take(4097).read_to_end(&mut bytes).map_err(|_| "Local graph service status is unavailable")?;
        if bytes.len() > 4096 { return Err("Local graph service status exceeds its limit".into()); }
        let mut status: ServiceStatus = serde_json::from_slice(&bytes).map_err(|_| "Local graph service status is invalid".to_owned())?;
        normalize_status(&mut status)?; Ok(status)
    }
    fn answer(&self, request: &AnswerRequest<'_>) -> Result<AnswerReply> {
        let body = serde_json::to_vec(request).map_err(|_| "Could not encode local answer request")?;
        if body.len() > 64 * 1024 { return Err("Local answer request exceeds its size limit".into()); }
        let agent = AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(1))
            .timeout_read(Duration::from_secs(60)).timeout_write(Duration::from_secs(4)).build();
        let response = agent.post(&format!("{}/v1/answer", self.base)).set("Authorization", &format!("Bearer {}", self.token))
            .set("Content-Type", "application/json").send_bytes(&body).map_err(|_| "Local answer request failed")?;
        if response.status() != 200 { return Err("Local answer service is unavailable".into()); }
        let mut bytes = Vec::new(); response.into_reader().take((64 * 1024 + 1) as u64).read_to_end(&mut bytes).map_err(|_| "Local answer response could not be read")?;
        if bytes.len() > 64 * 1024 { return Err("Local answer response exceeds its size limit".into()); }
        serde_json::from_slice(&bytes).map_err(|_| "Local answer response is invalid".into())
    }
    fn cancel_answer(&self, scope: &str, generation: u64, request_id: &str) -> Result<bool> {
        let body = CancelAnswerRequest { version: 1, scope, generation, request_id };
        let bytes = serde_json::to_vec(&body).map_err(|_| "Could not encode answer cancellation")?;
        let agent = AgentBuilder::new().redirects(0).timeout_connect(Duration::from_millis(250))
            .timeout_read(Duration::from_millis(750)).timeout_write(Duration::from_millis(750)).build();
        let response = agent.post(&format!("{}/v1/answer/cancel", self.base)).set("Authorization", &format!("Bearer {}", self.token))
            .set("Content-Type", "application/json").send_bytes(&bytes).map_err(|_| "Local answer cancellation is unavailable")?;
        if response.status() != 200 { return Err("Local answer cancellation is unavailable".into()); }
        let mut body = Vec::new(); response.into_reader().take(1025).read_to_end(&mut body).map_err(|_| "Local answer cancellation response could not be read")?;
        if body.len() > 1024 { return Err("Local answer cancellation response exceeds its limit".into()); }
        let reply: CancelReply = serde_json::from_slice(&body).map_err(|_| "Local answer cancellation response is invalid")?;
        Ok(reply.cancelled)
    }
}
fn cancel_obsolete_answers(scope: &str, generation: u64, client: &Client) {
    let obsolete = ACTIVE_ANSWERS.get_or_init(|| Mutex::new(HashMap::new())).lock().ok().map(|mut active| {
        let mut ids = Vec::new();
        for (id, answer) in active.iter_mut().filter(|(_, answer)| answer.scope == scope && answer.generation != generation) {
            if answer.dispatched { ids.push(id.clone()); } else { answer.generation = generation; }
        }
        ids.into_iter().filter_map(|id| active.remove(&id).map(|answer| (id, answer))).collect::<Vec<_>>()
    }).unwrap_or_default();
    for (request_id, answer) in obsolete { let _ = client.cancel_answer(scope, answer.generation, &request_id); }
}
pub fn begin_answer(vault: &Vault, request_id: &str) -> Result<AnswerStart> {
    validate_request_id(request_id)?;
    let control = vault.knowledge_control()?;
    if !control.enabled || !control.answer_allowed || control.answer_consent_version != 1
        || control.approved_answer_provider.is_empty() {
        return Ok(AnswerStart { allowed: false, replaced: None });
    }
    let mut active = ACTIVE_ANSWERS.get_or_init(|| Mutex::new(HashMap::new())).lock().map_err(|_| "Local answer coordinator is unavailable")?;
    if active.contains_key(request_id) { return Err("Answer request ID was already used by an active request".into()); }
    let previous = active.iter().find(|(_, answer)| answer.scope == vault.id).map(|(id, answer)| (id.clone(), answer.generation));
    if let Some((id, _)) = &previous { active.remove(id); }
    active.insert(request_id.to_owned(), ActiveAnswer { scope: vault.id.clone(), generation: control.generation, dispatched: false });
    Ok(AnswerStart { allowed: true, replaced: previous })
}
pub fn cancel_replaced_answer(scope: &str, previous: &Option<(String, u64)>) {
    if let (Some((request_id, generation)), Ok(client)) = (previous.as_ref(), Client::from_env()) {
        let _ = client.cancel_answer(scope, *generation, request_id);
    }
}
pub fn answer_is_active(scope: &str, request_id: &str) -> bool {
    ACTIVE_ANSWERS.get().and_then(|active| active.lock().ok())
        .and_then(|active| active.get(request_id).map(|answer| answer.scope == scope)).unwrap_or(false)
}
fn mark_answer_dispatched(scope: &str, request_id: &str, generation: u64) -> bool {
    ACTIVE_ANSWERS.get().and_then(|active| active.lock().ok()).and_then(|mut active| {
        let answer = active.get_mut(request_id)?;
        if answer.scope != scope || answer.generation != generation { return Some(false); }
        answer.dispatched = true;
        Some(true)
    }).unwrap_or(false)
}
fn remove_active_answer(scope: &str, request_id: &str) {
    if let Some(active) = ACTIVE_ANSWERS.get() {
        if let Ok(mut active) = active.lock() {
            if active.get(request_id).is_some_and(|answer| answer.scope == scope) { active.remove(request_id); }
        }
    }
}
fn cancel_scope_answers(scope: &str) {
    let active = ACTIVE_ANSWERS.get_or_init(|| Mutex::new(HashMap::new())).lock().ok().map(|mut rows| {
        let ids: Vec<String> = rows.iter().filter(|(_, answer)| answer.scope == scope).map(|(id, _)| id.clone()).collect();
        ids.into_iter().filter_map(|id| rows.remove(&id).map(|answer| (id, answer))).collect::<Vec<_>>()
    }).unwrap_or_default();
    if let Ok(client) = Client::from_env() {
        for (request_id, answer) in active { let _ = client.cancel_answer(scope, answer.generation, &request_id); }
    }
}
use std::io::Read;
trait StatusEnvelope { fn status_mut(&mut self) -> Option<&mut ServiceStatus>; }
impl StatusEnvelope for ServiceStatus { fn status_mut(&mut self) -> Option<&mut ServiceStatus> { Some(self) } }
impl StatusEnvelope for SearchReply { fn status_mut(&mut self) -> Option<&mut ServiceStatus> { Some(&mut self.status) } }
fn any_status_mut<T: StatusEnvelope>(value: &mut T) -> Option<&mut ServiceStatus> { value.status_mut() }
fn normalize_status(status: &mut ServiceStatus) -> Result<()> {
    if status.pending > 10_000 || status.indexed > 10_000 || status.failed > 10_000 { return Err("Local graph service status is invalid".into()); }
    if let Some(providers) = status.providers.as_ref() {
        for provider in [&providers.extraction, &providers.embedding, &providers.reranking] {
            if provider.is_empty() || provider.len() > 128 || provider.chars().any(char::is_control) {
                return Err("Local graph provider disclosure is invalid".into());
            }
        }
    }
    status.message = match status.state.as_str() {
        "ready" => "Local knowledge index is ready.".into(),
        "pending" | "processing" | "queued" => "Local knowledge indexing is queued or in progress.".into(),
        "purging" => "Local knowledge data is being removed.".into(),
        "empty" => "Local knowledge index has no indexed relationships yet.".into(),
        "capacity_exceeded" => "Local knowledge index is at its configured capacity.".into(),
        "disabled" => "Graph processing is disabled for this vault.".into(),
        "unavailable" | "failed" => "Local knowledge indexing is unavailable.".into(),
        _ => { status.state = "unknown".into(); "Local graph service returned an unknown status.".into() }
    };
    Ok(())
}
fn providers_authorize_enable(status: &ServiceStatus) -> bool {
    status.providers.as_ref().is_some_and(|p| !p.extraction.trim().is_empty()
        && !p.extraction.to_ascii_lowercase().contains("not configured")
        && !p.embedding.trim().is_empty() && !p.reranking.trim().is_empty())
}

fn sources(vault: &Vault) -> Result<Vec<Source>> {
    let rows = vault.list_with_deleted("", false)?;
    let mut out = Vec::new();
    let mut estimate = 0usize;
    for memory in rows.into_iter().filter(|m| m.state == "active" && m.conflict.is_none() && m.revision > 0) {
        if memory.note.len() > MAX_TEXT { return Err("A memory exceeds the local knowledge text limit".into()); }
        let snap = match vault.processing_snapshot(&memory.id, memory.revision) { Ok(value) => value, Err(_) => continue };
        let note_path = match snap.memory.note_path { Some(path) => path, None => continue };
        let source_hash_valid = if memory.source_name.is_empty() {
            // Text captures intentionally persist the empty-bytes sentinel in
            // legacy metadata. processing_snapshot resolves and verifies the
            // immutable Recall/Sources/{id}.txt bytes from the capture journal;
            // use that canonical hash for graph provenance, never the sentinel.
            memory.source_sha256 == sha(b"") && snap.source.mime_type == "text/plain"
                && sha(&snap.source.bytes) == snap.source.sha256
        } else {
            snap.source.sha256 == memory.source_sha256
        };
        if snap.memory.id != memory.id || snap.memory.revision != memory.revision || snap.memory.note != memory.note
            || snap.memory.source_name != memory.source_name || snap.memory.source_sha256 != memory.source_sha256
            || !source_hash_valid { continue; }
        let source_name = if memory.source_name.is_empty() { format!("{}.txt", memory.id) } else { memory.source_name };
        estimate = estimate.saturating_add(memory.note.len()).saturating_add(source_name.len()).saturating_add(note_path.len()).saturating_add(512);
        if estimate > MAX_SNAPSHOT { return Err("Current eligible vault text exceeds the Graphiti snapshot limit".into()); }
        out.push(Source { id: memory.id, revision: memory.revision, source_sha256: snap.source.sha256,
            note_sha256: sha(memory.note.as_bytes()), text: memory.note, source_name,
            note_path, captured_at: memory.captured_at, updated_at: memory.updated_at });
        if out.len() > MAX_SOURCES { return Err("Vault exceeds the local knowledge record limit".into()); }
    }
    Ok(out)
}
fn source_digest(scope: &str, sources: &[Source], control: &KnowledgeControl, answer_allowed: bool, answer_provider: &str) -> Result<String> {
    let material = serde_json::to_vec(&(scope, sources, control.enabled, control.include_existing,
        &control.existing_fence, &control.dismissed_facts, control.answer_allowed,
        control.answer_consent_version, &control.approved_answer_provider, answer_allowed, answer_provider))
        .map_err(|_| "Could not fingerprint local knowledge snapshot")?;
    Ok(sha(&material))
}
fn snapshot_with_client(vault: &Vault, rebuild: bool, client: &Client) -> Result<(ServiceStatus, Vec<Source>, KnowledgeControl)> {
    let mut control = vault.knowledge_control()?;
    // Revocation/purge snapshots are intentionally independent of source
    // enumeration: even a vault too large to index must be cancellable.
    let rows = if control.enabled { sources(vault)? } else { Vec::new() };
    let answer_provider = if control.enabled && control.answer_allowed {
        client.health().ok().and_then(|status| configured_answer_provider(&status).map(str::to_owned))
            .filter(|provider| provider == &control.approved_answer_provider).unwrap_or_default()
    } else { String::new() };
    let answer_allowed = !answer_provider.is_empty() && control.answer_consent_version == 1;
    let digest = source_digest(&vault.id, &rows, &control, answer_allowed, &answer_provider)?;
    control = vault.set_knowledge_snapshot_hash(&digest)?;
    cancel_obsolete_answers(&vault.id, control.generation, client);
    let eligible: Vec<String> = if control.enabled {
        rows.iter().filter(|s| control.include_existing || !control.existing_fence.contains(&s.id)).map(|s| s.id.clone()).collect()
    } else { Vec::new() };
    let allowed: BTreeSet<&str> = eligible.iter().map(String::as_str).collect();
    let eligible_sources: Vec<Source> = rows.iter().filter(|s| allowed.contains(s.id.as_str())).cloned().collect();
    let req = SnapshotRequest { version: 1, scope: &vault.id, generation: control.generation,
        processing_allowed: control.enabled, answer_allowed, answer_provider: &answer_provider, sources: &eligible_sources, eligible_ids: &eligible,
        suppressed_facts: &control.dismissed_facts, rebuild };
    let status: ServiceStatus = client.post("/v1/snapshot", &req, MAX_SNAPSHOT)?;
    Ok((status, rows, control))
}
fn snapshot(vault: &Vault, rebuild: bool) -> Result<(ServiceStatus, Vec<Source>, KnowledgeControl)> {
    let client = Client::from_env()?;
    snapshot_with_client(vault, rebuild, &client)
}
pub fn refresh(vault: &Vault) -> Result<ServiceStatus> { with_scope_lock(&vault.id, || snapshot(vault, false).map(|(status,_,_)| status)) }
pub fn rebuild(vault: &Vault) -> Result<ServiceStatus> { with_scope_lock(&vault.id, || snapshot(vault, true).map(|(status,_,_)| status)) }
pub fn status(vault: &Vault) -> Result<KnowledgeStatus> {
    let control = vault.knowledge_control()?;
    let service = Client::from_env().and_then(|client| client.health()).unwrap_or_else(|_| ServiceStatus {
        state: "unavailable".into(), pending: 0, indexed: 0, failed: 0,
        message: "Local graph service is not configured or reachable.".into(), providers: None,
    });
    let providers = service.providers.clone();
    let answer_provider = configured_answer_provider(&service).map(str::to_owned);
    let answer_enabled = control.enabled && control.answer_allowed && control.answer_consent_version == 1
        && answer_provider.as_deref() == Some(control.approved_answer_provider.as_str());
    Ok(KnowledgeStatus { enabled: control.enabled, include_existing: control.include_existing, generation: control.generation, service,
        provider_disclosure: "When enabled, current vault notes and questions may be processed by the listed extraction, embedding, and reranking providers. Review these recipients before enabling. No existing Recall consent is reused.".into(), providers, answer_enabled, answer_provider })
}
pub fn consent(vault: &Vault, enabled: bool, include_existing: bool) -> Result<KnowledgeControl> {
    let control = with_scope_lock(&vault.id, || {
        if !enabled {
            return vault.set_knowledge_consent(false, false, &BTreeSet::new());
        }
        if enabled {
            let status = Client::from_env()?.health()?;
            if !providers_authorize_enable(&status) {
                return Err("Review the configured graph providers before enabling knowledge processing".into());
            }
        }
        let rows = sources(vault)?; let ids: BTreeSet<String> = rows.iter().map(|s| s.id.clone()).collect();
        vault.set_knowledge_consent(enabled, include_existing, &ids)
    })?;
    if !enabled { cancel_scope_answers(&vault.id); }
    Ok(control)
}
fn configured_answer_provider(status: &ServiceStatus) -> Option<&str> {
    status.providers.as_ref().map(|providers| providers.extraction.as_str())
        .filter(|identity| !identity.trim().is_empty() && !identity.to_ascii_lowercase().contains("not configured"))
}
pub fn answer_consent(vault: &Vault, enabled: bool) -> Result<KnowledgeControl> {
    let control = with_scope_lock(&vault.id, || {
        if !enabled { return vault.set_knowledge_answer_consent(false, ""); }
        let control = vault.knowledge_control()?;
        if !control.enabled { return Err("Enable connected knowledge before answer consent".into()); }
        let status = Client::from_env()?.health()?;
        let provider = configured_answer_provider(&status).ok_or("Model answers are not configured")?;
        vault.set_knowledge_answer_consent(true, provider)
    })?;
    if !enabled { cancel_scope_answers(&vault.id); }
    Ok(control)
}
fn answer_static(status: &str) -> &'static str {
    match status {
        "supported" => "Selected exact passages from current notes. These quotations are evidence selections, not a verified synthesized answer.",
        "insufficient" => "Current source passages do not support an answer to this question.",
        "cancelled" => "The answer request was cancelled; local source matches remain available.",
        "stale" => "The source or consent changed while answering; no selections are shown.",
        _ => "Model answers are unavailable; local source and related-knowledge matches remain available.",
    }
}
fn answer_response(vault: &Vault, question: &str, mut fallback: crate::memory_query::Answer,
    mut status: &str, mut selections: Vec<AnswerSelection>, provider: Option<String>) -> MemoryAnswer {
    // The source and graph cards were gathered before the possibly long model
    // wait. Rebind local hits and graph evidence at the return boundary so a
    // correction, deletion, fence change, or revocation cannot leak stale cards.
    if let Ok(current) = crate::memory_query::ask(vault, question) {
        fallback.hits = current.hits;
        fallback.message = current.message;
    } else {
        fallback.hits.clear();
    }
    let binding = (vault.knowledge_control(), sources(vault));
    let mut graph_current = false;
    if let (Ok(control), Ok(current_sources)) = binding {
        fallback.hits.retain(|hit| current_sources.iter().any(|source|
            source.id == hit.memory_id && source.revision == hit.revision && source.source_sha256 == hit.source_sha256
        ));
        let final_control = vault.knowledge_control().ok();
        if control.enabled && final_control.as_ref().is_some_and(|current| current.generation == control.generation) {
            fallback.graph_relationships = validate_after_reconcile(
                std::mem::take(&mut fallback.graph_relationships), &current_sources, &control, control.generation,
            );
            graph_current = true;
            if !control.answer_allowed || control.answer_consent_version != 1
                || provider.as_deref() != Some(control.approved_answer_provider.as_str()) {
                if !selections.is_empty() { selections.clear(); status = "stale"; }
            } else {
                let eligible: BTreeSet<&str> = current_sources.iter().filter(|source|
                    control.include_existing || !control.existing_fence.contains(&source.id)
                ).map(|source| source.id.as_str()).collect();
                let valid = selections.iter().all(|selection| current_sources.iter().any(|source|
                    source.id == selection.source_id && eligible.contains(source.id.as_str())
                        && source.revision == selection.revision && source.source_sha256 == selection.source_sha256
                        && source.note_sha256 == selection.note_sha256 && source.text.contains(&selection.quote)
                ));
                if !valid && !selections.is_empty() { selections.clear(); status = "stale"; }
            }
        } else {
            fallback.graph_relationships.clear();
            if !selections.is_empty() { selections.clear(); status = "stale"; }
        }
    } else {
        fallback.hits.clear();
        fallback.graph_relationships.clear();
        if !selections.is_empty() { selections.clear(); status = "stale"; }
    }
    if !graph_current {
        fallback.knowledge_status = None;
    }
    if !fallback.graph_relationships.is_empty() {
        fallback.message = if fallback.hits.is_empty() {
            "Related graph knowledge was found. These are inferred, unverified relationships; inspect the cited current notes. This is not a generated answer.".into()
        } else {
            "Source-backed matches and related graph knowledge were found. Graph relationships are inferred and unverified; inspect the cited current notes. This is not a generated answer.".into()
        };
    }
    MemoryAnswer { sources: fallback, status: status.into(), message: answer_static(status).into(), selections, answer_provider: provider }
}
fn answer_candidates(answer: &crate::memory_query::Answer) -> Vec<String> {
    let mut candidates = Vec::new();
    for id in answer.hits.iter().map(|hit| hit.memory_id.as_str()).chain(
        answer.graph_relationships.iter().flat_map(|row| std::iter::once(row.source_id.as_str()).chain(row.supports.iter().map(|support| support.source_id.as_str())))
    ) {
        if uuid::Uuid::parse_str(id).is_ok() && !candidates.iter().any(|candidate| candidate == id) {
            candidates.push(id.to_owned());
            if candidates.len() == MAX_ANSWER_CANDIDATES { break; }
        }
    }
    candidates
}
fn answer_reply_valid(reply: &AnswerReply, sources: &[Source], eligible_ids: &BTreeSet<String>, candidate_ids: &BTreeSet<String>) -> bool {
    if reply.status != "supported" { return reply.selections.is_empty(); }
    if reply.selections.is_empty() || reply.selections.len() > 2 { return false; }
    let current: BTreeMap<&str, &Source> = sources.iter().filter(|source| eligible_ids.contains(&source.id)).map(|source| (source.id.as_str(), source)).collect();
    let mut seen = BTreeSet::new();
    reply.selections.iter().all(|selection| {
        if !candidate_ids.contains(&selection.source_id) || !eligible_ids.contains(&selection.source_id)
            || !seen.insert(selection.source_id.as_str()) || selection.revision == 0
            || selection.quote.trim().is_empty() || selection.quote.chars().count() > 800
            || selection.quote.chars().any(|ch| ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t') {
            return false;
        }
        current.get(selection.source_id.as_str()).is_some_and(|source| {
            source.revision == selection.revision && source.source_sha256 == selection.source_sha256
                && source.note_sha256 == selection.note_sha256 && source.text.contains(&selection.quote)
        })
    })
}
pub fn answer(vault: &Vault, question: &str, request_id: &str, source_answer: crate::memory_query::Answer) -> Result<MemoryAnswer> {
    if question.trim().is_empty() || question.len() > MAX_QUERY || question.chars().any(char::is_control) {
        return Err("Ask a bounded memory question".into());
    }
    validate_request_id(request_id)?;
    let control = vault.knowledge_control()?;
    if !control.enabled || !control.answer_allowed || control.answer_consent_version != 1
        || control.approved_answer_provider.is_empty() {
        return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), None));
    }
    let client = match Client::from_env() {
        Ok(client) => client,
        Err(_) => return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), None)),
    };
    let provider = match client.health().ok().and_then(|status| configured_answer_provider(&status).map(str::to_owned)) {
        Some(provider) if provider == control.approved_answer_provider => provider,
        _ => return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), None)),
    };
    let (snapshot_status, rows, current_control) = match with_scope_lock(&vault.id, || snapshot_with_client(vault, false, &client)) {
        Ok(snapshot) => snapshot,
        Err(_) => return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider))),
    };
    let _ = snapshot_status;
    if !current_control.enabled || !current_control.answer_allowed || current_control.answer_consent_version != 1
        || current_control.approved_answer_provider != provider {
        return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider)));
    }
    let eligible_ids: BTreeSet<String> = rows.iter().filter(|row|
        current_control.include_existing || !current_control.existing_fence.contains(&row.id)
    ).map(|row| row.id.clone()).collect();
    let candidate_ids: Vec<String> = answer_candidates(&source_answer).into_iter().filter(|id| eligible_ids.contains(id)).take(MAX_ANSWER_CANDIDATES).collect();
    if candidate_ids.is_empty() {
        return Ok(answer_response(vault, question, source_answer, "insufficient", Vec::new(), Some(provider)));
    }
    let generation = current_control.generation;
    if !answer_is_active(&vault.id, request_id) {
        return Ok(answer_response(vault, question, source_answer, "cancelled", Vec::new(), Some(provider)));
    }
    if !mark_answer_dispatched(&vault.id, request_id, generation) {
        return Ok(answer_response(vault, question, source_answer, "cancelled", Vec::new(), Some(provider)));
    }
    let request = AnswerRequest { version: 1, scope: &vault.id, generation, request_id,
        question, candidate_ids: &candidate_ids };
    let reply = client.answer(&request);
    let still_active = ACTIVE_ANSWERS.get().and_then(|active| active.lock().ok()).and_then(|active|
        active.get(request_id).map(|current| current.scope == vault.id && current.generation == generation));
    if still_active != Some(true) {
        let current = vault.knowledge_control()?;
        if !current.enabled || !current.answer_allowed || current.generation != generation
            || current.approved_answer_provider != provider {
            remove_active_answer(&vault.id, request_id);
            return Ok(answer_response(vault, question, source_answer, "stale", Vec::new(), Some(provider)));
        }
        remove_active_answer(&vault.id, request_id);
        return Ok(answer_response(vault, question, source_answer, "cancelled", Vec::new(), Some(provider)));
    }
    let (_current_status, current_rows, current_control) = match with_scope_lock(&vault.id, || snapshot_with_client(vault, false, &client)) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            remove_active_answer(&vault.id, request_id);
            return Ok(answer_response(vault, question, source_answer, "stale", Vec::new(), Some(provider)));
        },
    };
    let current_provider = client.health().ok().and_then(|status| configured_answer_provider(&status).map(str::to_owned));
    if !current_control.enabled || !current_control.answer_allowed || current_control.answer_consent_version != 1
        || current_control.generation != generation || current_control.approved_answer_provider != provider
        || current_provider.as_deref() != Some(provider.as_str()) {
        remove_active_answer(&vault.id, request_id);
        return Ok(answer_response(vault, question, source_answer, "stale", Vec::new(), Some(provider)));
    }
    remove_active_answer(&vault.id, request_id);
    let reply = match reply {
        Ok(reply) => reply,
        Err(_) => return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider))),
    };
    if !["supported", "insufficient", "unavailable", "cancelled", "stale"].contains(&reply.status.as_str()) {
        return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider)));
    }
    if reply.status != "supported" {
        if !reply.selections.is_empty() { return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider))); }
        return Ok(answer_response(vault, question, source_answer, &reply.status, Vec::new(), Some(provider)));
    }
    let current_eligible: BTreeSet<String> = current_rows.iter().filter(|row|
        current_control.include_existing || !current_control.existing_fence.contains(&row.id)
    ).map(|row| row.id.clone()).collect();
    if !answer_reply_valid(&reply, &current_rows, &current_eligible, &candidate_ids.iter().cloned().collect()) {
        return Ok(answer_response(vault, question, source_answer, "unavailable", Vec::new(), Some(provider)));
    }
    Ok(answer_response(vault, question, source_answer, "supported", reply.selections, Some(provider)))
}
pub fn cancel_answer(scope: &str, request_id: &str) -> Result<bool> {
    validate_request_id(request_id)?;
    let active = ACTIVE_ANSWERS.get_or_init(|| Mutex::new(HashMap::new())).lock()
        .map_err(|_| "Local answer coordinator is unavailable")?.get(request_id).filter(|active| active.scope == scope).cloned();
    let Some(active) = active else { return Ok(false); };
    remove_active_answer(scope, request_id);
    let client = Client::from_env()?;
    let cancelled = client.cancel_answer(scope, active.generation, request_id)?;
    Ok(cancelled)
}
pub fn dismiss(vault: &Vault, fact_id: &str) -> Result<KnowledgeControl> { with_scope_lock(&vault.id, || vault.dismiss_knowledge_fact(fact_id)) }
pub fn search(vault: &Vault, query: &str, include_history: bool) -> Result<SearchReply> {
    if query.len() > MAX_QUERY || query.chars().any(char::is_control) { return Err("Knowledge search query exceeds its limit".into()); }
    with_scope_lock(&vault.id, || {
        let (status, _, control) = snapshot(vault, false)?;
        if !control.enabled { return Ok(SearchReply { status, relationships: Vec::new() }); }
        if include_history { return Err("Historical graph evidence is not currently supported".into()); }
        let client = Client::from_env()?;
        let mut reply: SearchReply = client.post("/v1/search", &SearchRequest { version: 1, scope: &vault.id,
            generation: control.generation, query, limit: MAX_LIMIT, include_history: false }, 2 * 1024 * 1024)?;
        if reply.relationships.len() > MAX_LIMIT {
            return Err("Local graph service returned too many relationships".into());
        }
        // Reconcile through the generation ledger after transport. This catches
        // edits, removals, consent changes, and dismissals made by another process
        // while the request was in flight; changed snapshots are pushed before any
        // graph result can be returned to the webview.
        let (current_status, current_sources, current_control) = snapshot(vault, false)?;
        if !current_control.enabled || current_control.generation != control.generation {
            return Ok(SearchReply { status: current_status, relationships: Vec::new() });
        }
        reply.relationships = validate_after_reconcile(reply.relationships, &current_sources, &current_control, control.generation);
        Ok(reply)
    })
}
fn validate_after_reconcile(relationships: Vec<Relationship>, sources: &[Source], control: &KnowledgeControl, expected_generation: u64) -> Vec<Relationship> {
    if !control.enabled || control.generation != expected_generation { return Vec::new(); }
    let eligible_sources: Vec<Source> = sources.iter().filter(|source|
        control.include_existing || !control.existing_fence.contains(&source.id)
    ).cloned().collect();
    validate_relationships(relationships.into_iter().filter(|relationship|
        !control.dismissed_facts.contains(&relationship.id)
    ).collect(), &eligible_sources)
}
fn validate_relationships(relationships: Vec<Relationship>, sources: &[Source]) -> Vec<Relationship> {
    let current: BTreeMap<&str, &Source> = sources.iter().map(|s| (s.id.as_str(), s)).collect();
    relationships.into_iter().filter(|r| {
        if r.id.is_empty() || r.id.len() > 256 || r.id.chars().any(char::is_control) || !r.inferred
            || r.supports.is_empty() || r.supports.len() > MAX_SOURCES || r.related_source_ids.len() > MAX_SOURCES
            || r.fact.is_empty() || r.fact.len() > 4096 || r.quote.is_empty() || r.quote.len() > MAX_TEXT
            || r.subject.len() > 512 || r.object.len() > 512 || r.predicate.len() > 128
            || r.subject_type.len() > 64 || r.object_type.len() > 64 || r.uncertainty.len() > 2048
            || uuid::Uuid::parse_str(&r.subject_id).is_err() || uuid::Uuid::parse_str(&r.object_id).is_err()
            || ["same_as", "same_person", "identity_match", "is_the_same_person"].contains(&r.predicate.to_ascii_lowercase().as_str()) {
            return false;
        }
        let Some(primary) = current.get(r.source_id.as_str()) else { return false; };
        if r.revision != primary.revision || r.source_sha256 != primary.source_sha256 || r.note_sha256 != primary.note_sha256
            || r.source_name != primary.source_name || r.note_path != primary.note_path || !primary.text.contains(&r.quote) { return false; }
        let mut supported_ids = BTreeSet::new();
        let support_ok = r.supports.iter().all(|support| {
            let valid = current.get(support.source_id.as_str()).is_some_and(|s|
                s.revision == support.revision && s.source_sha256 == support.source_sha256 && s.note_sha256 == support.note_sha256
                    && !support.quote.is_empty() && support.quote.len() <= MAX_TEXT && s.text.contains(&support.quote));
            if valid { supported_ids.insert(support.source_id.as_str()); }
            valid
        });
        support_ok && supported_ids.contains(r.source_id.as_str())
            && r.related_source_ids.iter().all(|id| current.contains_key(id.as_str()) && supported_ids.contains(id.as_str()))
            && r.supports.iter().any(|s| s.source_id == r.source_id && s.quote == r.quote)
    }).collect()
}
/// Queue a coalesced background snapshot. This is called after durable writes;
/// the bounded single worker keeps provider/service latency off capture paths.
pub fn best_effort_refresh(vault: &Vault) {
    let worker = refresh_worker();
    let scope = vault.id.clone();
    let mut rows = match worker.entries.lock() { Ok(rows) => rows, Err(_) => return };
    if let Some(entry) = rows.get_mut(&scope) {
        entry.vault = vault.clone(); entry.dirty = true; return;
    }
    if rows.len() >= 32 { return; }
    rows.insert(scope.clone(), RefreshEntry { vault: vault.clone(), dirty: false });
    drop(rows);
    if matches!(worker.sender.try_send(scope.clone()), Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_))) {
        if let Ok(mut rows) = worker.entries.lock() { rows.remove(&scope); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graph_url_is_loopback_only_and_token_is_required() {
        for url in ["https://127.0.0.1:8766", "http://localhost:8766", "http://192.168.1.4:8766", "http://127.0.0.1:8766/path"] {
            std::env::set_var("RECALL_GRAPH_URL", url);
            assert!(Client::from_env().is_err(), "{url}");
        }
        std::env::remove_var("RECALL_GRAPH_URL"); std::env::remove_var("RECALL_GRAPH_TOKEN");
        assert!(Client::from_env().is_err());
    }
    #[test]
    fn provider_disclosure_must_be_configured_before_consent() {
        let status = |extraction: &str| ServiceStatus { state:"empty".into(),pending:0,indexed:0,failed:0,message:String::new(),providers:Some(ProviderDisclosure {
            extraction:extraction.into(),embedding:"Local embeddings".into(),reranking:"Local RRF".into() }) };
        assert!(providers_authorize_enable(&status("Anthropic Claude sonnet (configured)")));
        assert!(!providers_authorize_enable(&status("Anthropic Claude sonnet (not configured)")));
        assert!(!providers_authorize_enable(&ServiceStatus { providers:None, ..status("configured") }));
    }
    #[test]
    fn known_backend_statuses_keep_honest_ui_messages() {
        for (state, message) in [("queued", "queued or in progress"), ("purging", "being removed"),
            ("empty", "no indexed relationships"), ("capacity_exceeded", "configured capacity")] {
            let mut status = ServiceStatus { state:state.into(),pending:0,indexed:0,failed:0,message:"untrusted backend detail".into(),providers:None };
            normalize_status(&mut status).unwrap();
            assert!(status.message.contains(message));
        }
    }
    #[test]
    fn graph_support_rejects_stale_missing_and_unquoted_sources() {
        let source = Source { id: "00000000-0000-4000-8000-000000000001".into(), revision: 2,
            source_sha256: "a".repeat(64), note_sha256: "b".repeat(64), text: "# Synthetic\nmeeting quote".into(),
            source_name:"synthetic.txt".into(),note_path:"synthetic.md".into(),captured_at:"2026-10-12T00:00:00Z".into(),updated_at:"2026-10-12T00:00:00Z".into() };
        let support = RelationshipSupport { source_id:source.id.clone(),revision:2,source_sha256:source.source_sha256.clone(),note_sha256:source.note_sha256.clone(),quote:"meeting quote".into() };
        let relationship = |revision: u64, quote: &str, supports: Vec<RelationshipSupport>| Relationship {
            id: "graph:synthetic".into(), source_id: source.id.clone(), revision,
            source_sha256: source.source_sha256.clone(), note_sha256: source.note_sha256.clone(),
            source_name: source.source_name.clone(), note_path: source.note_path.clone(), quote: quote.into(),
            subject: "Cedar meeting".into(), subject_type:"event".into(), predicate:"rescheduled".into(), object:"October 19".into(), object_type:"date".into(),
            subject_id: uuid::Uuid::new_v4().to_string(), object_id: uuid::Uuid::new_v4().to_string(),
            fact:"Cedar meeting rescheduled".into(), valid_at:None, invalid_at:None, extracted_at:"2026-10-12T00:00:00Z".into(), inferred:true,
            uncertainty:"Graph-derived, unverified".into(), related_source_ids:vec![], supports,
        };
        let exact = relationship(2, "meeting quote", vec![support.clone()]);
        assert_eq!(validate_relationships(vec![exact], &[source.clone()]).len(), 1);
        let stale = relationship(1, "meeting quote", vec![support.clone()]);
        assert!(validate_relationships(vec![stale], &[source.clone()]).is_empty());
        let invented = relationship(2, "invented quote", vec![support]);
        assert!(validate_relationships(vec![invented], &[source.clone()]).is_empty());
        let mut name_match = relationship(2, "meeting quote", vec![RelationshipSupport { source_id:source.id.clone(),revision:2,source_sha256:source.source_sha256.clone(),note_sha256:source.note_sha256.clone(),quote:"meeting quote".into() }]);
        name_match.predicate = "same_person".into();
        assert!(validate_relationships(vec![name_match], &[source]).is_empty());
    }
    #[test]
    fn native_text_capture_uses_verified_original_hash_in_graph_snapshot() {
        use crate::librarian::organization_tests as fixture;
        let (_temp, vault, _, _) = fixture::setup();
        let id = uuid::Uuid::new_v4().to_string();
        let note = "Synthetic native text capture: Alice Chen works on Project Aurora.";
        let captured = vault.capture_note(&id, note).unwrap();
        assert_eq!(captured.source_sha256, sha(b"")); // legacy no-attachment sentinel
        let original = vault.processing_snapshot(&id, captured.revision).unwrap();
        assert_eq!(original.source.mime_type, "text/plain");
        assert_eq!(original.source.bytes, note.as_bytes());
        let snapshot = sources(&vault).unwrap().into_iter().find(|source| source.id == id).expect("real native text capture should be graph eligible");
        assert_eq!(snapshot.source_sha256, sha(note.as_bytes()));
        assert_ne!(snapshot.source_sha256, captured.source_sha256);
        assert_eq!(snapshot.source_name, format!("{id}.txt"));
        assert_eq!(snapshot.note_sha256, sha(captured.note.as_bytes()));
        assert!(snapshot.text.contains("Project Aurora"));
    }
    #[test]
    fn post_search_reconciliation_enforces_generation_consent_fence_and_dismissals() {
        let source = Source { id: "00000000-0000-4000-8000-000000000001".into(), revision: 1,
            source_sha256: "a".repeat(64), note_sha256: "b".repeat(64), text: "# Synthetic\nmeeting quote".into(),
            source_name:"synthetic.txt".into(),note_path:"synthetic.md".into(),captured_at:"2026-10-12T00:00:00Z".into(),updated_at:"2026-10-12T00:00:00Z".into() };
        let support = RelationshipSupport { source_id:source.id.clone(),revision:1,source_sha256:source.source_sha256.clone(),note_sha256:source.note_sha256.clone(),quote:"meeting quote".into() };
        let relationship = Relationship {
            id: "synthetic-fact".into(), source_id: source.id.clone(), revision: 1,
            source_sha256: source.source_sha256.clone(), note_sha256: source.note_sha256.clone(),
            source_name: source.source_name.clone(), note_path: source.note_path.clone(), quote: "meeting quote".into(),
            subject_id: uuid::Uuid::new_v4().to_string(), subject: "Cedar meeting".into(), subject_type:"event".into(),
            predicate:"rescheduled".into(), object_id:uuid::Uuid::new_v4().to_string(), object:"October 19".into(), object_type:"date".into(),
            fact:"Cedar meeting rescheduled".into(), valid_at:None, invalid_at:None, extracted_at:"2026-10-12T00:00:00Z".into(), inferred:true,
            uncertainty:"Graph-derived, unverified".into(), related_source_ids:vec![], supports:vec![support],
        };
        let mut control = KnowledgeControl { version: 1, vault_id: "00000000-0000-4000-8000-000000000099".into(),
            enabled: false, include_existing: false, generation: 0, snapshot_sha256: String::new(),
            existing_fence: BTreeSet::new(), dismissed_facts: BTreeSet::new(), answer_allowed: false,
            answer_consent_version: 0, approved_answer_provider: String::new() };
        control.enabled = true; control.generation = 7;
        assert_eq!(validate_after_reconcile(vec![relationship.clone()], &[source.clone()], &control, 7).len(), 1);
        control.generation = 8;
        assert!(validate_after_reconcile(vec![relationship.clone()], &[source.clone()], &control, 7).is_empty());
        control.generation = 7; control.existing_fence.insert(source.id.clone());
        assert!(validate_after_reconcile(vec![relationship.clone()], &[source.clone()], &control, 7).is_empty());
        control.existing_fence.clear(); control.dismissed_facts.insert(relationship.id.clone());
        assert!(validate_after_reconcile(vec![relationship.clone()], &[source], &control, 7).is_empty());
        control.enabled = false; control.dismissed_facts.clear();
        assert!(validate_after_reconcile(vec![relationship], &[], &control, 7).is_empty());
    }
    #[test]
    fn consent_fence_and_dismissals_survive_reopen_without_changing_vault_format() {
        use crate::librarian::organization_tests as fixture;
        let (temp, vault, _, memory) = fixture::setup();
        let existing = BTreeSet::from([memory.clone()]);
        let enabled = vault.set_knowledge_consent(true, false, &existing).unwrap();
        assert!(enabled.enabled && !enabled.include_existing && enabled.existing_fence.contains(&memory));
        assert!(!vault.knowledge_control().unwrap().include_existing);
        let dismissed = vault.dismiss_knowledge_fact("synthetic-fact").unwrap();
        assert!(dismissed.dismissed_facts.contains("synthetic-fact"));
        let reopened = Vault::open(&temp.0).unwrap();
        let persisted = reopened.knowledge_control().unwrap();
        assert!(persisted.enabled && persisted.existing_fence.contains(&memory));
        assert!(persisted.dismissed_facts.contains("synthetic-fact"));
        assert!(persisted.generation > enabled.generation);
    }
    #[test]
    fn version_one_controls_read_without_rewrite_and_migrate_only_on_answer_opt_in() {
        use crate::librarian::organization_tests as fixture;
        let (temp, vault, _, memory_id) = fixture::setup();
        let original = vault.processing_snapshot(&memory_id, 1).unwrap().source.bytes;
        let control_path = temp.0.join("Recall/_meta/knowledge/control.json");
        std::fs::create_dir_all(control_path.parent().unwrap()).unwrap();
        let legacy = format!(r#"{{"version":1,"vault_id":"{}","enabled":true,"include_existing":true,"generation":8,"snapshot_sha256":"","existing_fence":[],"dismissed_facts":[]}}"#, vault.id);
        std::fs::write(&control_path, legacy.as_bytes()).unwrap();
        let read = vault.knowledge_control().unwrap();
        assert_eq!(read.version, 1);
        assert!(!read.answer_allowed && read.answer_consent_version == 0 && read.approved_answer_provider.is_empty());
        assert_eq!(std::fs::read(&control_path).unwrap(), legacy.as_bytes(), "reading v1 must preserve bytes");

        let provider = "Anthropic Claude synthetic-model (configured)";
        let migrated = vault.set_knowledge_answer_consent(true, provider).unwrap();
        assert_eq!(migrated.version, 2);
        assert!(migrated.answer_allowed && migrated.answer_consent_version == 1);
        assert_eq!(migrated.approved_answer_provider, provider);
        assert!(migrated.generation > read.generation && migrated.snapshot_sha256.is_empty());
        let reopened = Vault::open(&temp.0).unwrap();
        let after = reopened.processing_snapshot(&memory_id, 1).unwrap();
        assert_eq!(after.source.bytes, original);
        assert!(reopened.knowledge_control().unwrap().answer_allowed);
    }
    #[test]
    fn answer_quote_validation_is_all_or_nothing_and_source_bound() {
        let source = Source { id: "00000000-0000-4000-8000-000000000001".into(), revision: 2,
            source_sha256: "a".repeat(64), note_sha256: "b".repeat(64), text: "# Synthetic\nProject Aurora is led by Alice Chen.".into(),
            source_name: "synthetic.txt".into(), note_path: "synthetic.md".into(), captured_at: "2026-10-13T00:00:00Z".into(), updated_at: "2026-10-13T00:00:00Z".into() };
        let selected = AnswerSelection { source_id: source.id.clone(), revision: 2, source_sha256: source.source_sha256.clone(),
            note_sha256: source.note_sha256.clone(), quote: "Project Aurora is led by Alice Chen.".into() };
        let eligible = BTreeSet::from([source.id.clone()]);
        let candidates = eligible.clone();
        let reply = AnswerReply { status: "supported".into(), selections: vec![selected.clone()], message: "untrusted remote prose".into() };
        assert!(answer_reply_valid(&reply, &[source.clone()], &eligible, &candidates));
        let mut forged = selected.clone(); forged.quote = "Alice Chen founded a different company.".into();
        assert!(!answer_reply_valid(&AnswerReply { selections: vec![forged], ..reply.clone() }, &[source.clone()], &eligible, &candidates));
        let mut stale = selected.clone(); stale.source_sha256 = "c".repeat(64);
        assert!(!answer_reply_valid(&AnswerReply { selections: vec![stale], ..reply.clone() }, &[source.clone()], &eligible, &candidates));
        assert!(!answer_reply_valid(&AnswerReply { selections: vec![selected.clone(), selected.clone(), selected], ..reply.clone() }, &[source], &eligible, &candidates));
        assert!(answer_reply_valid(&AnswerReply { status: "insufficient".into(), selections: Vec::new(), message: String::new() }, &[], &eligible, &candidates));
        assert!(!answer_reply_valid(&AnswerReply { status: "insufficient".into(), selections: vec![AnswerSelection { source_id: "x".into(), revision: 1, source_sha256: String::new(), note_sha256: String::new(), quote: "bad".into() }], message: String::new() }, &[], &eligible, &candidates));
    }
    #[test]
    fn answer_without_separate_consent_returns_local_fallback_without_provider_configuration() {
        use crate::librarian::organization_tests as fixture;
        let (_temp, vault, _, _) = fixture::setup();
        let base = crate::memory_query::ask(&vault, "Project Aurora").unwrap();
        let result = answer(&vault, "Project Aurora", &uuid::Uuid::new_v4().to_string(), base).unwrap();
        assert_eq!(result.status, "unavailable");
        assert!(result.selections.is_empty());
        assert!(result.message.contains("local source"));
    }
    #[test]
    fn answer_fallback_rebinds_keyword_cards_and_suppresses_stale_or_revoked_graph_evidence() {
        use crate::librarian::organization_tests as fixture;
        let (_temp, vault, _, memory_id) = fixture::setup();
        let before = sources(&vault).unwrap();
        let old_source = before.iter().find(|source| source.id == memory_id).unwrap().clone();
        let old_quote = "Utility late.";
        assert!(old_source.text.contains(old_quote));
        vault.set_knowledge_consent(true, true, &BTreeSet::from([memory_id.clone()])).unwrap();
        let mut prior = crate::memory_query::ask(&vault, "utility late").unwrap();
        prior.graph_relationships.push(Relationship {
            id: "synthetic-stale-fact".into(), source_id: old_source.id.clone(), revision: old_source.revision,
            source_sha256: old_source.source_sha256.clone(), note_sha256: old_source.note_sha256.clone(),
            source_name: old_source.source_name.clone(), note_path: old_source.note_path.clone(), quote: old_quote.into(),
            subject_id: uuid::Uuid::new_v4().to_string(), subject: "Utility".into(), subject_type: "topic".into(),
            predicate: "status".into(), object_id: uuid::Uuid::new_v4().to_string(), object: "late".into(), object_type: "status".into(),
            fact: "Utility is late".into(), valid_at: None, invalid_at: None, extracted_at: "2026-10-13T00:00:00Z".into(),
            inferred: true, uncertainty: "Inferred".into(), related_source_ids: vec![],
            supports: vec![RelationshipSupport { source_id: old_source.id.clone(), revision: old_source.revision,
                source_sha256: old_source.source_sha256.clone(), note_sha256: old_source.note_sha256.clone(), quote: old_quote.into() }],
        });
        let changed = vault.correct(&memory_id, 1, &uuid::Uuid::new_v4().to_string(), "Utility remains under review; no delivery date confirmed.").unwrap();
        let rebound = answer_response(&vault, "utility", prior, "stale", Vec::new(), None);
        assert_eq!(rebound.status, "stale");
        assert_eq!(rebound.sources.hits.len(), 1);
        assert_eq!(rebound.sources.hits[0].revision, changed.revision);
        assert!(rebound.sources.hits[0].current_excerpt.contains("no delivery date confirmed"));
        assert!(rebound.sources.graph_relationships.is_empty(), "old-revision graph evidence must be suppressed");

        let current_source = sources(&vault).unwrap().into_iter().find(|source| source.id == memory_id).unwrap();
        let mut pre_revocation = crate::memory_query::ask(&vault, "utility").unwrap();
        pre_revocation.graph_relationships.push(Relationship {
            id: "synthetic-current-fact".into(), source_id: current_source.id.clone(), revision: current_source.revision,
            source_sha256: current_source.source_sha256.clone(), note_sha256: current_source.note_sha256.clone(),
            source_name: current_source.source_name.clone(), note_path: current_source.note_path.clone(), quote: "no delivery date confirmed".into(),
            subject_id: uuid::Uuid::new_v4().to_string(), subject: "Utility".into(), subject_type: "topic".into(),
            predicate: "status".into(), object_id: uuid::Uuid::new_v4().to_string(), object: "under review".into(), object_type: "status".into(),
            fact: "Utility remains under review".into(), valid_at: None, invalid_at: None, extracted_at: "2026-10-13T00:00:00Z".into(),
            inferred: true, uncertainty: "Inferred".into(), related_source_ids: vec![],
            supports: vec![RelationshipSupport { source_id: current_source.id.clone(), revision: current_source.revision,
                source_sha256: current_source.source_sha256.clone(), note_sha256: current_source.note_sha256.clone(), quote: "no delivery date confirmed".into() }],
        });
        vault.set_knowledge_consent(false, false, &BTreeSet::new()).unwrap();
        let revoked = answer_response(&vault, "utility", pre_revocation, "stale", Vec::new(), None);
        assert!(revoked.sources.graph_relationships.is_empty(), "revoked graph evidence must be suppressed");
        assert_eq!(revoked.sources.hits.len(), 1, "current local keyword evidence remains available after graph revocation");
        assert!(revoked.sources.knowledge_status.is_none());
    }
    #[test]
    fn answer_registration_precedes_dispatch_and_cancelled_preparation_cannot_charge() {
        use crate::librarian::organization_tests as fixture;
        let (_temp, vault, _, memory_id) = fixture::setup();
        vault.set_knowledge_consent(true, true, &BTreeSet::from([memory_id])).unwrap();
        vault.set_knowledge_answer_consent(true, "Anthropic Claude synthetic-model (configured)").unwrap();
        let first = uuid::Uuid::new_v4().to_string();
        let started = begin_answer(&vault, &first).unwrap();
        assert!(started.allowed);
        assert!(answer_is_active(&vault.id, &first), "request must be cancellable before retrieval begins");
        // Mirrors cancel-before-dispatch: native removes the authorized scope
        // entry first; the answer worker's atomic dispatch mark must then fail.
        remove_active_answer(&vault.id, &first);
        assert!(!mark_answer_dispatched(&vault.id, &first, vault.knowledge_control().unwrap().generation));
        let second = uuid::Uuid::new_v4().to_string();
        let _ = begin_answer(&vault, &first).unwrap();
        let replacement = begin_answer(&vault, &second).unwrap();
        assert_eq!(replacement.replaced.as_ref().map(|(id, _)| id.as_str()), Some(first.as_str()));
        assert!(!answer_is_active(&vault.id, &first));
        assert!(answer_is_active(&vault.id, &second));
        remove_active_answer(&vault.id, &second);
    }
    #[test]
    fn revocation_skips_failed_source_enumeration_and_retries_empty_snapshot() {
        use crate::librarian::organization_tests as fixture;
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let (temp, vault, _, memory) = fixture::setup();
        let existing = BTreeSet::from([memory]);
        vault.set_knowledge_consent(true, true, &existing).unwrap();
        let before = vault.knowledge_control().unwrap().generation;
        // Make source enumeration fail in this disposable vault while keeping
        // the managed directory valid for the journaled consent writer.
        let invalid_entry = temp.0.join("Recall/History/not-a-uuid");
        std::fs::write(&invalid_entry, b"synthetic malformed entry").unwrap();
        assert!(sources(&vault).is_err(), "fixture must make source enumeration fail");
        let disabled = consent(&vault, false, false).expect("oversized notes cannot block local revocation");
        assert!(!disabled.enabled);
        assert!(disabled.generation > before);
        assert!(vault.knowledge_control().unwrap().generation == disabled.generation);

        // A failed loopback transport leaves the local fence persisted.
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let offline = Client { base: format!("http://127.0.0.1:{port}"), token: "x".repeat(32),
            agent: AgentBuilder::new().redirects(0).timeout_connect(Duration::from_millis(200))
                .timeout_read(Duration::from_millis(200)).timeout_write(Duration::from_millis(200)).build() };
        assert!(snapshot_with_client(&vault, false, &offline).is_err());
        assert!(!vault.knowledge_control().unwrap().enabled);

        // On reconnect, the only acceptable payload is an empty disabled
        // snapshot; an accepted async purge remains pending, not complete.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 4096];
            let mut content_length = None;
            loop {
                let count = stream.read(&mut chunk).unwrap();
                bytes.extend_from_slice(&chunk[..count]);
                if content_length.is_none() {
                    if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        content_length = headers.lines().find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
                        });
                    }
                }
                if let (Some(end), Some(length)) = (bytes.windows(4).position(|window| window == b"\r\n\r\n"), content_length) {
                    if bytes.len() >= end + 4 + length { break; }
                }
            }
            let end = bytes.windows(4).position(|window| window == b"\r\n\r\n").unwrap();
            let length = content_length.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
            let response = r#"{"state":"purging","pending":1,"indexed":0,"failed":0,"message":"purge accepted"}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            body
        });
        let online = Client { base: format!("http://127.0.0.1:{port}"), token: "x".repeat(32),
            agent: AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(1))
                .timeout_read(Duration::from_secs(2)).timeout_write(Duration::from_secs(2)).build() };
        let (status, rows, control) = snapshot_with_client(&vault, false, &online).unwrap();
        let payload = server.join().unwrap();
        assert!(rows.is_empty());
        assert!(payload["sources"].as_array().unwrap().is_empty());
        assert!(payload["eligible_ids"].as_array().unwrap().is_empty());
        assert_eq!(payload["processing_allowed"], false);
        assert_eq!(payload["generation"], control.generation);
        assert_eq!(status.state, "purging");
        assert_ne!(status.state, "disabled", "accepted purge is still pending");
    }
    #[test]
    #[ignore = "opt-in: uses only a fresh synthetic vault and an explicitly configured loopback Graphiti service"]
    fn synthetic_loopback_end_to_end_consent_rebuild_and_search() {
        let root = std::env::var("RECALL_GRAPH_SYNTHETIC_VAULT").expect("set to a fresh synthetic test directory");
        let root = std::path::PathBuf::from(root);
        assert!(root.is_absolute(), "synthetic vault path must be absolute");
        assert!(!root.join("Recall/_meta/manifest.json").exists(), "refusing a pre-existing vault");
        std::fs::create_dir_all(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        let operation = uuid::Uuid::new_v4().to_string();
        let memory = vault.capture_note(&operation, "Synthetic graph fixture. Fictional Alice Chen works on Project Aurora for Example Labs.").unwrap();
        let consent = consent(&vault, true, true).unwrap();
        assert!(consent.enabled && consent.include_existing);
        let indexed = rebuild(&vault).expect("configured loopback graph service must accept synthetic snapshot");
        assert_ne!(indexed.state, "unavailable");
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        let result = loop {
            let result = search(&vault, "Fictional Alice Chen Project Aurora", false).expect("native graph search should complete");
            if !result.relationships.is_empty() { break result; }
            assert!(std::time::Instant::now() < deadline, "Graphiti did not return a supported synthetic relationship before the bounded deadline");
            std::thread::sleep(Duration::from_millis(500));
        };
        assert!(!result.relationships.is_empty());
        assert!(result.relationships.iter().all(|relationship| relationship.supports.iter().any(|support| support.source_id == memory.id)));
        assert!(memory.note.contains("Fictional Alice Chen works on Project Aurora for Example Labs"));
    }
    #[test]
    #[ignore = "opt-in: opens the retained synthetic integration vault read-only after restart"]
    fn synthetic_vault_resume_is_read_only_and_retains_native_sources() {
        let root = std::env::var("RECALL_GRAPH_SYNTHETIC_VAULT").expect("set to the retained synthetic integration vault");
        let root = std::path::PathBuf::from(root);
        assert!(root.is_absolute(), "synthetic vault path must be absolute");
        assert!(root.join("Recall/_meta/manifest.json").exists(), "run the synthetic loopback integration first");
        let vault = Vault::open(&root).unwrap();
        let control_before = vault.knowledge_control().unwrap();
        assert!(control_before.enabled && control_before.include_existing);
        let answer = crate::memory_query::ask(&vault, "Fictional Alice Chen Project Aurora").unwrap();
        assert_eq!(answer.hits.len(), 1);
        assert!(answer.hits[0].current_excerpt.contains("Example Labs"));
        assert_eq!(vault.knowledge_control().unwrap().generation, control_before.generation);
    }
    #[test]
    #[ignore = "opt-in: sends two bounded questions about the retained synthetic vault to the configured answer provider"]
    fn synthetic_loopback_answers_are_current_source_quotes_and_abstain_without_evidence() {
        let root = std::env::var("RECALL_GRAPH_SYNTHETIC_VAULT").expect("set to the retained synthetic integration vault");
        let root = std::path::PathBuf::from(root);
        assert!(root.is_absolute(), "synthetic vault path must be absolute");
        assert!(root.join("Recall/_meta/manifest.json").exists(), "run the synthetic loopback integration first");
        let vault = Vault::open(&root).unwrap();
        let before = sources(&vault).unwrap();
        let source = before.iter().find(|source| source.text.contains("Fictional Alice Chen works on Project Aurora for Example Labs"))
            .expect("retained synthetic capture must be present").clone();
        let source_bytes = vault.source(&source.id).unwrap().bytes;
        let before_control = vault.knowledge_control().unwrap();
        assert!(before_control.enabled && before_control.include_existing);
        let consent = answer_consent(&vault, true).expect("synthetic answer consent should bind to configured provider");
        assert!(consent.answer_allowed && consent.answer_consent_version == 1);

        // Wait for the already-existing source to be current before issuing a
        // single attempt. Answer requests are deliberately never auto-retried.
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        loop {
            let refreshed = refresh(&vault).expect("loopback snapshot should synchronize");
            if refreshed.pending == 0 && refreshed.indexed > 0 { break; }
            assert!(std::time::Instant::now() < deadline, "synthetic snapshot did not become answer-ready");
            std::thread::sleep(Duration::from_millis(500));
        }
        let status = status(&vault).unwrap();
        assert!(status.answer_enabled);
        assert_eq!(status.answer_provider.as_deref(), Some(consent.approved_answer_provider.as_str()));

        let supported_id = uuid::Uuid::new_v4().to_string();
        let supported_start = begin_answer(&vault, &supported_id).unwrap();
        let supported = crate::memory_query::answer_with_knowledge(
            &vault, "What does Fictional Alice Chen do on Project Aurora?", &supported_id, supported_start,
        ).expect("synthetic supported answer request");
        assert_eq!(supported.status, "supported");
        assert!(!supported.selections.is_empty());
        assert!(supported.selections.iter().all(|selection| {
            selection.source_id == source.id && selection.revision == source.revision
                && selection.source_sha256 == source.source_sha256 && selection.note_sha256 == source.note_sha256
                && source.text.contains(&selection.quote)
        }), "answers must quote only exact current source text");

        let unsupported_id = uuid::Uuid::new_v4().to_string();
        let unsupported_start = begin_answer(&vault, &unsupported_id).unwrap();
        let unsupported = crate::memory_query::answer_with_knowledge(
            &vault, "What is Fictional Alice Chen's favorite color on Project Aurora?", &unsupported_id, unsupported_start,
        ).expect("synthetic unsupported answer request");
        assert_eq!(unsupported.status, "insufficient");
        assert!(unsupported.selections.is_empty());

        let after = vault.source(&source.id).unwrap();
        assert_eq!(after.bytes, source_bytes, "answering must not mutate original evidence");
        let current = sources(&vault).unwrap().into_iter().find(|candidate| candidate.id == source.id).unwrap();
        assert_eq!(current.revision, source.revision, "answering must not mutate source revision");
        assert_eq!(current.note_sha256, source.note_sha256);
    }
}
