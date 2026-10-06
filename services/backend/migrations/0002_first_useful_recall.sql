-- RCL-002 First Useful Recall: consent, durable processing jobs, source memories, search chunks,
-- AI usage accounting. Run as the OWNER role.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'recall_worker') then
    create role recall_worker nologin nosuperuser nobypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Capture state machine: stored -> processing -> ready | needs_review | failed; failed -> processing.
-- ---------------------------------------------------------------------------
alter table captures drop constraint captures_status_check;
alter table captures add constraint captures_status_check
  check (status in ('awaiting_upload', 'stored', 'processing', 'ready', 'needs_review', 'failed'));
alter table captures drop constraint captures_check;
alter table captures add constraint captures_stored_at_check
  check ((status = 'awaiting_upload') = (stored_at is null));

create or replace function recall_captures_guard() returns trigger language plpgsql as $$
declare verified integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'captures are not deletable yet' using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.client_capture_id is distinct from old.client_capture_id
     or new.device_id is distinct from old.device_id
     or new.created_by is distinct from old.created_by
     or new.source_kind is distinct from old.source_kind
     or new.captured_at is distinct from old.captured_at
     or new.page_count is distinct from old.page_count
     or new.request_digest is distinct from old.request_digest then
    raise exception 'immutable capture field changed' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'awaiting_upload' and new.status = 'stored')
    or (old.status = 'stored' and new.status = 'processing')
    or (old.status = 'processing' and new.status in ('ready', 'needs_review', 'failed', 'stored'))
    or (old.status = 'failed' and new.status = 'processing')
  ) then
    raise exception 'invalid capture transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.status = 'stored' and old.status = 'awaiting_upload' then
    select count(*) into verified from source_objects s
      where s.capture_id = new.id and s.verified_at is not null and s.server_sha256 is not null;
    if verified <> new.page_count then
      raise exception 'capture cannot be stored: % of % pages verified', verified, new.page_count
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table ai_consents (
  workspace_id   uuid primary key references workspaces(id),
  enabled        boolean not null,
  provider       text not null check (char_length(provider) between 1 and 50),
  policy_version text not null check (char_length(policy_version) between 1 and 50),
  decided_by     uuid not null,
  decided_at     timestamptz not null default now(),
  version        integer not null default 1
);

create table processing_jobs (
  id                   uuid primary key,
  workspace_id         uuid not null references workspaces(id),
  capture_id           uuid not null,
  input_fingerprint    text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  processor_version    text not null check (char_length(processor_version) between 1 and 100),
  status               text not null default 'queued'
                         check (status in ('queued', 'leased', 'succeeded', 'failed', 'cancelled')),
  attempts             integer not null default 0 check (attempts >= 0),
  max_attempts         integer not null check (max_attempts between 1 and 10),
  manual_retries       integer not null default 0 check (manual_retries between 0 and 3),
  not_before           timestamptz not null default now(),
  lease_owner          text,
  lease_token          uuid,
  lease_expires_at     timestamptz,
  last_error_code      text,
  last_error_retryable boolean,
  blocked_reason       text check (blocked_reason is null or blocked_reason in ('budget_exhausted', 'not_configured')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  finished_at          timestamptz,
  foreign key (workspace_id, capture_id) references captures (workspace_id, id),
  unique (workspace_id, capture_id, input_fingerprint, processor_version),
  check ((status = 'leased') = (lease_token is not null and lease_expires_at is not null))
);
create index processing_jobs_claim_idx on processing_jobs (status, not_before);

create table memories (
  id               uuid primary key,
  workspace_id     uuid not null references workspaces(id),
  capture_id       uuid not null,
  current_revision integer not null check (current_revision >= 1),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, capture_id),
  foreign key (workspace_id, capture_id) references captures (workspace_id, id)
);

create table memory_revisions (
  workspace_id      uuid not null references workspaces(id),
  memory_id         uuid not null,
  revision          integer not null check (revision >= 1),
  origin            text not null check (origin in ('model')),
  job_id            uuid not null references processing_jobs(id),
  processor_version text not null,
  model_id          text not null,
  summary           text,
  extraction        jsonb not null,
  validation        jsonb not null,
  created_at        timestamptz not null default now(),
  primary key (memory_id, revision),
  foreign key (workspace_id, memory_id) references memories (workspace_id, id)
);

create table search_chunks (
  id              uuid primary key,
  workspace_id    uuid not null references workspaces(id),
  memory_id       uuid not null,
  revision        integer not null,
  source_id       uuid,
  kind            text not null check (kind in ('summary', 'transcription', 'statement', 'context')),
  ordinal         smallint,
  text            text not null check (char_length(text) between 1 and 40000),
  epistemic_state text,
  eligible        boolean not null default true,
  tsv             tsvector generated always as (to_tsvector('english', text)) stored,
  foreign key (workspace_id, memory_id) references memories (workspace_id, id),
  foreign key (memory_id, revision) references memory_revisions (memory_id, revision)
);
create index search_chunks_tsv_idx on search_chunks using gin (tsv);
create index search_chunks_memory_idx on search_chunks (workspace_id, memory_id);

create table ai_usage (
  id                 uuid primary key,
  workspace_id       uuid not null references workspaces(id),
  job_id             uuid references processing_jobs(id),
  purpose            text not null check (purpose in ('interpret', 'repair', 'answer')),
  model_id           text not null,
  input_tokens       integer not null check (input_tokens >= 0),
  output_tokens      integer not null check (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) not null check (estimated_cost_usd >= 0),
  created_at         timestamptz not null default now()
);
create index ai_usage_created_idx on ai_usage (created_at);

-- Revisions and usage are append-only; extraction content is immutable once committed.
create function recall_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end $$;
create trigger memory_revisions_append_only before update or delete on memory_revisions
  for each row execute function recall_append_only();
create trigger ai_usage_append_only before update or delete on ai_usage
  for each row execute function recall_append_only();

-- ---------------------------------------------------------------------------
-- RLS. API role: membership + selected workspace (as in 0001). Worker role: the workspace set
-- from the job it claimed (no membership: the worker is not a user). Claim/budget queries span
-- workspaces only on processing_jobs and ai_usage, and only for the worker role.
-- ---------------------------------------------------------------------------
alter table ai_consents      enable row level security;
alter table processing_jobs  enable row level security;
alter table memories         enable row level security;
alter table memory_revisions enable row level security;
alter table search_chunks    enable row level security;
alter table ai_usage         enable row level security;
alter table ai_consents      force row level security;
alter table processing_jobs  force row level security;
alter table memories         force row level security;
alter table memory_revisions force row level security;
alter table search_chunks    force row level security;
alter table ai_usage         force row level security;

create policy ai_consents_member on ai_consents for all to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id)
              and decided_by = recall_current_user_id());
create policy processing_jobs_member on processing_jobs for all to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy memories_member on memories for select to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy memory_revisions_member on memory_revisions for select to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy search_chunks_member on search_chunks for select to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy ai_usage_member on ai_usage for all to recall_app
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id)
              and purpose = 'answer');

create policy processing_jobs_worker on processing_jobs for all to recall_worker using (true) with check (true);
create policy ai_usage_worker_write on ai_usage for insert to recall_worker
  with check (workspace_id = recall_current_workspace_id());
create policy ai_consents_worker on ai_consents for select to recall_worker
  using (workspace_id = recall_current_workspace_id());
create policy captures_worker on captures for all to recall_worker
  using (workspace_id = recall_current_workspace_id())
  with check (workspace_id = recall_current_workspace_id());
create policy source_objects_worker on source_objects for select to recall_worker
  using (workspace_id = recall_current_workspace_id());
create policy memories_worker on memories for all to recall_worker
  using (workspace_id = recall_current_workspace_id())
  with check (workspace_id = recall_current_workspace_id());
create policy memory_revisions_worker on memory_revisions for all to recall_worker
  using (workspace_id = recall_current_workspace_id())
  with check (workspace_id = recall_current_workspace_id());
create policy search_chunks_worker on search_chunks for all to recall_worker
  using (workspace_id = recall_current_workspace_id())
  with check (workspace_id = recall_current_workspace_id());

-- Deployment-wide spend (the owner's money), exposed ONLY as two aggregate numbers; no rows,
-- no workspace ids, no content. Budgets are enforced against this by the worker and by Ask.
do $$ begin
  execute format('create policy ai_usage_owner_aggregate on ai_usage for select to %I using (true)', current_user);
end $$;
create function recall_ai_spend(out day_usd numeric, out month_usd numeric)
  language sql stable security definer set search_path = pg_catalog, public
  as $$
    select coalesce(sum(estimated_cost_usd) filter (
             where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'), 0),
           coalesce(sum(estimated_cost_usd) filter (
             where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'), 0)
    from ai_usage
  $$;
revoke all on function recall_ai_spend() from public;
grant execute on function recall_ai_spend() to recall_app, recall_worker;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert on ai_consents, processing_jobs to recall_app;
grant update (enabled, provider, policy_version, decided_by, decided_at, version) on ai_consents to recall_app;
grant update (status, attempts, manual_retries, not_before, last_error_code, last_error_retryable,
              blocked_reason, updated_at, finished_at, lease_owner, lease_token, lease_expires_at)
  on processing_jobs to recall_app;
grant select on memories, memory_revisions, search_chunks to recall_app;
grant select, insert on ai_usage to recall_app;

grant usage on schema public to recall_worker;
grant select on ai_consents, source_objects to recall_worker;
grant select on captures to recall_worker;
grant update (status, version) on captures to recall_worker;
grant select, update on processing_jobs to recall_worker;
grant select, insert on memories, memory_revisions, search_chunks, ai_usage to recall_worker;
grant update (current_revision, updated_at) on memories to recall_worker;
grant update (eligible) on search_chunks to recall_worker;
