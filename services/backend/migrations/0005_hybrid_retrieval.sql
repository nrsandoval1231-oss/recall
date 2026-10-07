-- RCL-003B: versioned semantic index metadata and optional pgvector storage.
-- Keyword/entity retrieval remains available when pgvector is not installed.
create table retrieval_index_config (
  workspace_id uuid primary key references workspaces(id),
  provider text not null,
  model_id text not null,
  dimensions integer not null check (dimensions > 0),
  embedding_version text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table retrieval_index_config enable row level security;
alter table retrieval_index_config force row level security;
create policy retrieval_index_config_member on retrieval_index_config for all to recall_app
  using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select, insert, update on retrieval_index_config to recall_app;
create policy retrieval_index_config_worker on retrieval_index_config for select to recall_worker
  using (workspace_id=recall_current_workspace_id());
grant select on retrieval_index_config to recall_worker;
-- The narrow discovery helper below runs as the migration owner and must enumerate
-- enabled workspace ids without granting the worker a global table read. FORCE RLS
-- still applies to a non-superuser table owner, so give that owner an explicit policy.
do $$ begin
  execute format(
    'create policy retrieval_index_config_owner_discovery on retrieval_index_config for select to %I using (enabled)',
    current_user
  );
end $$;
create function recall_embedding_enabled_workspaces()
returns table(workspace_id uuid) language sql stable security definer set search_path=pg_catalog,public as $$
  select ric.workspace_id from public.retrieval_index_config ric where ric.enabled
$$;
revoke all on function recall_embedding_enabled_workspaces() from public;
grant execute on function recall_embedding_enabled_workspaces() to recall_worker;

-- A reservation is recorded before the external embedding request.  It is short lived and
-- counts against the same workspace budget while in flight, so concurrent requests cannot all
-- pass a read-only budget check and overspend together.
create table embedding_reservations (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  purpose text not null check (purpose in ('query','document')),
  model_id text not null,
  estimated_cost_usd numeric(12,6) not null check (estimated_cost_usd >= 0),
  status text not null check (status in ('reserved','completed','released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  finished_at timestamptz
);
create index embedding_reservations_budget_idx on embedding_reservations (workspace_id, status, created_at);
alter table embedding_reservations enable row level security;
alter table embedding_reservations force row level security;
create policy embedding_reservations_member on embedding_reservations for all to recall_app
  using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select, insert, update on embedding_reservations to recall_app;
create policy embedding_reservations_worker_read on embedding_reservations for select to recall_worker using (true);
create policy embedding_reservations_worker_write on embedding_reservations for insert to recall_worker
  with check (workspace_id=recall_current_workspace_id());
create policy embedding_reservations_worker_update on embedding_reservations for update to recall_worker
  using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id());
grant select, insert, update on embedding_reservations to recall_worker;

-- Budget totals reveal only aggregate spend, matching recall_ai_spend.
do $$ begin
  execute format('create policy embedding_budget_owner on embedding_reservations for select to %I using (true)',current_user);
end $$;
create function recall_embedding_reserved_spend(out day_usd numeric,out month_usd numeric)
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(sum(estimated_cost_usd) filter(where created_at>=date_trunc('day',now())),0),
         coalesce(sum(estimated_cost_usd),0)
  from public.embedding_reservations where status='reserved' and expires_at>now()
    and created_at>=date_trunc('month',now())
$$;
revoke all on function recall_embedding_reserved_spend() from public;
grant execute on function recall_embedding_reserved_spend() to recall_app,recall_worker;

alter table ai_usage drop constraint if exists ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check
  check (purpose in ('interpret','repair','answer','embedding'));

create extension if not exists pgcrypto;
do $$ begin
  if exists (select 1 from pg_available_extensions where name='vector') then
    execute 'create extension if not exists vector';
  end if;
  if exists (select 1 from pg_extension where extname='vector') then
    execute $vector$create table if not exists search_chunk_embeddings (
      workspace_id uuid not null,
      chunk_id uuid not null,
      memory_id uuid not null,
      memory_revision integer not null,
      embedding_version text not null,
      model_id text not null,
      dimensions integer not null check (dimensions > 0),
      source_text_sha256 text not null,
      status text not null default 'current' check (status in ('current','stale','failed')),
      embedding vector,
      created_at timestamptz not null default now(),
      primary key (workspace_id, chunk_id, embedding_version),
      check (vector_dims(embedding) = dimensions),
      check (status<>'current' or embedding is not null),
      foreign key (chunk_id) references search_chunks(id)
    )$vector$;
    execute 'alter table search_chunk_embeddings enable row level security';
    execute 'alter table search_chunk_embeddings force row level security';
    execute 'create policy search_chunk_embeddings_member on search_chunk_embeddings for all to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))';
    execute 'grant select,insert,update on search_chunk_embeddings to recall_app';
    execute 'create policy search_chunk_embeddings_worker on search_chunk_embeddings for all to recall_worker using (workspace_id=recall_current_workspace_id()) with check (workspace_id=recall_current_workspace_id())';
    execute 'grant select,insert,update on search_chunk_embeddings to recall_worker';
  end if;
end $$;
