-- RCL-003 Trusted Memory: universal entities, evidence-backed claim history,
-- suggested actions, and durable human corrections. Run as OWNER.

alter table idempotency_records drop constraint idempotency_records_operation_family_check;
alter table idempotency_records add constraint idempotency_records_operation_family_check
  check (operation_family in ('capture.create', 'capture.finalize', 'capture.retry_processing',
                             'entity.create', 'entity.merge', 'entity.split', 'memory.correct', 'action.update'));

alter table memory_revisions drop constraint memory_revisions_origin_check;
alter table memory_revisions add constraint memory_revisions_origin_check
  check (origin in ('model', 'user'));
alter table memory_revisions alter column job_id drop not null;

create table entities (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  kind text not null check (kind in ('person','organization','place','thing','event','project','topic')),
  canonical_name text not null check (char_length(btrim(canonical_name)) between 1 and 500),
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index entities_lookup_idx on entities (workspace_id, kind, lower(canonical_name));

create table identity_operations (
  id uuid primary key, workspace_id uuid not null references workspaces(id),
  operation text not null check (operation in ('merge','split')),
  source_entity_id uuid not null, target_entity_id uuid not null, moved_mention_ids jsonb not null,
  actor_id uuid not null, created_at timestamptz not null default now(),
  foreign key (workspace_id, source_entity_id) references entities (workspace_id, id),
  foreign key (workspace_id, target_entity_id) references entities (workspace_id, id), check (source_entity_id <> target_entity_id)
);

create table entity_aliases (
  id uuid primary key,
  workspace_id uuid not null,
  entity_id uuid not null,
  alias text not null check (char_length(btrim(alias)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, entity_id, alias),
  foreign key (workspace_id, entity_id) references entities (workspace_id, id)
);
create index entity_aliases_lookup_idx on entity_aliases (workspace_id, lower(alias));

create table mentions (
  id uuid primary key,
  workspace_id uuid not null,
  memory_id uuid not null,
  revision integer not null,
  local_id text not null check (char_length(local_id) between 1 and 100),
  text text not null check (char_length(btrim(text)) between 1 and 500),
  kind text not null check (kind in ('person','organization','place','thing','event','project','topic','unknown')),
  entity_id uuid,
  evidence_key text not null check (evidence_key ~ '^[a-f0-9]{64}$'),
  resolution_status text not null default 'unresolved' check (resolution_status in ('unresolved','candidate','accepted','rejected')),
  evidence jsonb not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, memory_id) references memories (workspace_id, id),
  foreign key (memory_id, revision) references memory_revisions (memory_id, revision),
  foreign key (workspace_id, entity_id) references entities (workspace_id, id),
  unique (memory_id, revision, local_id)
);

create table entity_links (
  id uuid primary key,
  workspace_id uuid not null,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  relation_type text not null check (char_length(btrim(relation_type)) between 1 and 100),
  status text not null default 'candidate' check (status in ('candidate','accepted','rejected')),
  evidence jsonb not null,
  valid_from timestamptz,
  valid_to timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  unique (workspace_id, from_entity_id, to_entity_id, relation_type),
  foreign key (workspace_id, from_entity_id) references entities (workspace_id, id),
  foreign key (workspace_id, to_entity_id) references entities (workspace_id, id)
);

create table claims (
  id uuid primary key,
  workspace_id uuid not null,
  memory_id uuid not null,
  evidence_key text not null check (evidence_key ~ '^[a-f0-9]{64}$'),
  current_version integer not null default 1 check (current_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, memory_id) references memories (workspace_id, id),
  unique (workspace_id, id),
  unique (workspace_id, memory_id, evidence_key)
);
create table claim_revisions (
  workspace_id uuid not null,
  claim_id uuid not null,
  memory_id uuid not null,
  version integer not null check (version >= 1),
  memory_revision integer not null,
  origin text not null check (origin in ('model','user')),
  kind text not null check (kind in ('observation','claim','idea','decision','preference','action','commitment','question','relationship')),
  text text not null check (char_length(btrim(text)) between 1 and 10000),
  value_text text,
  epistemic_state text not null check (epistemic_state in ('reported','uncertain','question','confirmed_by_user','superseded','retracted')),
  attribution_text text,
  temporal_text text,
  valid_from timestamptz,
  valid_to timestamptz,
  supersedes_claim_id uuid,
  evidence jsonb not null,
  supersedes_version integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (claim_id, version),
  foreign key (workspace_id, claim_id) references claims (workspace_id, id),
  foreign key (memory_id, memory_revision) references memory_revisions (memory_id, revision),
  foreign key (workspace_id, supersedes_claim_id) references claims (workspace_id, id),
  check (supersedes_version is null or supersedes_version < version)
);
-- Every claim-derived search projection carries its canonical claim identity.  Retrieval must
-- consult this relationship rather than guessing from matching text.
alter table search_chunks add column claim_id uuid;
alter table search_chunks add constraint search_chunks_workspace_claim_id_fkey
  foreign key (workspace_id, claim_id) references claims (workspace_id, id);
create index search_chunks_claim_idx on search_chunks (workspace_id, claim_id) where claim_id is not null;
-- A user correction writes claim and memory revisions atomically; neither
-- half may commit alone, regardless of their insertion order.
alter table claim_revisions alter constraint claim_revisions_memory_id_memory_revision_fkey
  deferrable initially deferred;

create table actions (
  id uuid primary key,
  workspace_id uuid not null,
  memory_id uuid not null,
  local_id text not null check (char_length(local_id) between 1 and 100),
  text text not null check (char_length(btrim(text)) between 1 and 10000),
  status text not null check (status in ('suggested','open','done','cancelled')),
  due_text text,
  evidence jsonb not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, memory_id) references memories (workspace_id, id),
  unique (workspace_id, memory_id, local_id)
);
create table memory_overrides (
  workspace_id uuid not null,
  memory_id uuid not null,
  claim_id uuid,
  target_key uuid not null,
  field text not null check (field in ('summary','transcription','claim_text','claim_epistemic_state','claim_validity','mention_identity','relationship')),
  value text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (memory_id, field, target_key),
  foreign key (workspace_id, memory_id) references memories (workspace_id, id),
  foreign key (workspace_id, claim_id) references claims (workspace_id, id),
  check ((field in ('claim_text','claim_epistemic_state','claim_validity')) = (claim_id is not null))
);

create trigger claim_revisions_append_only before update or delete on claim_revisions
  for each row execute function recall_append_only();

alter table entities enable row level security; alter table entities force row level security;
alter table entity_aliases enable row level security; alter table entity_aliases force row level security;
alter table mentions enable row level security; alter table mentions force row level security;
alter table entity_links enable row level security; alter table entity_links force row level security;
alter table claims enable row level security; alter table claims force row level security;
alter table claim_revisions enable row level security; alter table claim_revisions force row level security;
alter table actions enable row level security; alter table actions force row level security;
alter table memory_overrides enable row level security; alter table memory_overrides force row level security;
alter table identity_operations enable row level security; alter table identity_operations force row level security;

create policy memories_correction_member on memories for update to recall_app
  using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy memory_revisions_correction_member on memory_revisions for insert to recall_app
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy search_chunks_correction_member on search_chunks for all to recall_app
  using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));

create policy entities_member on entities for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy identity_operations_member on identity_operations for select to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy identity_operations_insert on identity_operations for insert to recall_app
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)
              and actor_id=recall_current_user_id());
create policy entity_aliases_member on entity_aliases for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy mentions_member on mentions for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy entity_links_member on entity_links for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy claims_member on claims for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy claim_revisions_member on claim_revisions for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy actions_member on actions for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy memory_overrides_member on memory_overrides for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy entities_worker on entities for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy entity_aliases_worker on entity_aliases for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy mentions_worker on mentions for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy entity_links_worker on entity_links for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy claims_worker on claims for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy claim_revisions_worker on claim_revisions for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy actions_worker on actions for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
create policy memory_overrides_worker on memory_overrides for select to recall_worker using (workspace_id=recall_current_workspace_id());

grant select, insert, update on entities, entity_aliases, actions, memory_overrides to recall_app;
grant select, insert on identity_operations to recall_app;
grant select, update on mentions, entity_links, claims to recall_app;
grant insert on entity_links to recall_app;
grant select, insert on claim_revisions to recall_app;
grant select, update (current_revision, updated_at) on memories to recall_app;
grant insert on memory_revisions to recall_app;
grant select, insert, update (eligible, claim_id) on search_chunks to recall_app;
grant select, insert, update on entities, entity_aliases, mentions, entity_links, claims, actions to recall_worker;
grant select, insert on claim_revisions to recall_worker;
grant select on memory_overrides to recall_worker;
