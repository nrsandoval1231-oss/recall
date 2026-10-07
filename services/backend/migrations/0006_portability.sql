-- RCL-005 deletion queue. Database visibility is removed before an adapter purges bytes.
alter table idempotency_records drop constraint idempotency_records_operation_family_check;
alter table idempotency_records add constraint idempotency_records_operation_family_check
  check (operation_family in ('capture.create','capture.finalize','capture.retry_processing','entity.create',
    'entity.merge','entity.split','memory.correct','action.update','capture.delete','source.delete','memory.delete','workspace.erase'));
alter table captures add column deleted_at timestamptz;
alter table captures add column deleted_by uuid;
create table object_purge_jobs (
 id uuid primary key, workspace_id uuid not null references workspaces(id), source_id uuid not null,
 storage_key text not null, attempts integer not null default 0, status text not null default 'queued'
 check(status in ('queued','leased','succeeded','failed')), last_error text,
 lease_token uuid, lease_expires_at timestamptz, not_before timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,source_id)
);
alter table object_purge_jobs enable row level security; alter table object_purge_jobs force row level security;
create policy object_purge_worker on object_purge_jobs for all to recall_worker using (true) with check (workspace_id=recall_current_workspace_id());
grant select,insert,update on object_purge_jobs to recall_worker;
create table memory_suppressions (
 workspace_id uuid not null references workspaces(id), capture_id uuid not null,
 deleted_by uuid not null, created_at timestamptz not null default now(),
 primary key(workspace_id,capture_id), foreign key(workspace_id,capture_id) references captures(workspace_id,id)
);
alter table memory_suppressions enable row level security; alter table memory_suppressions force row level security;
create policy memory_suppressions_app on memory_suppressions for select to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy memory_suppressions_worker on memory_suppressions for select to recall_worker using (workspace_id=recall_current_workspace_id());
grant select on memory_suppressions to recall_app,recall_worker;

-- Deletion is a narrow command, not a broad DELETE privilege for the API.
-- A user-supplied GUC cannot relax guards: only the actual table owner running
-- the scoped SECURITY DEFINER command can enter purge mode.
create function recall_purge_active() returns boolean language sql stable
set search_path=pg_catalog,public as $$
  select current_user = pg_get_userbyid((select relowner from pg_class where oid='public.captures'::regclass))
     and nullif(current_setting('app.recall_purge',true),'') = public.recall_current_workspace_id()::text
$$;

drop trigger captures_guard on captures;
create trigger captures_guard before update or delete on captures for each row
  when (not recall_purge_active()) execute function recall_captures_guard();
drop trigger source_objects_guard on source_objects;
create trigger source_objects_guard before update or delete on source_objects for each row
  when (not recall_purge_active()) execute function recall_source_objects_guard();
drop trigger memory_revisions_append_only on memory_revisions;
create trigger memory_revisions_append_only before update or delete on memory_revisions for each row
  when (not recall_purge_active()) execute function recall_append_only();
drop trigger claim_revisions_append_only on claim_revisions;
create trigger claim_revisions_append_only before update or delete on claim_revisions for each row
  when (not recall_purge_active()) execute function recall_append_only();
drop trigger ai_usage_append_only on ai_usage;
create trigger ai_usage_append_only before update or delete on ai_usage for each row
  when (not recall_purge_active()) execute function recall_append_only();
create trigger identity_operations_append_only before update or delete on identity_operations for each row
  when (not recall_purge_active()) execute function recall_append_only();

do $$ declare tbl text; begin
  foreach tbl in array array['captures','source_objects','processing_jobs','memories','memory_revisions',
    'search_chunks','claims','claim_revisions','mentions','actions','memory_overrides','entity_links',
    'entities','entity_aliases','identity_operations','object_purge_jobs','memory_suppressions','ai_usage','ai_consents','devices',
    'retrieval_index_config','embedding_reservations'] loop
    execute format('create policy purge_owner on %I for all to %I using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))',tbl,current_user);
  end loop;
  if to_regclass('public.search_chunk_embeddings') is not null then
    execute format('create policy purge_owner on search_chunk_embeddings for all to %I using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))',current_user);
  end if;
end $$;

create function recall_purge_memory(target uuid) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; previous_mode text; proposed_ids uuid[];
begin
  ws := public.recall_current_workspace_id();
  if not public.recall_is_member(ws) or not exists(select 1 from public.memories where workspace_id=ws and id=target) then
    raise exception 'memory not found' using errcode='no_data_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:' || ws::text,0));
  previous_mode := coalesce(current_setting('app.recall_purge',true),'');
  perform set_config('app.recall_purge',ws::text,true);
  if to_regclass('public.search_chunk_embeddings') is not null then
    execute 'delete from public.search_chunk_embeddings where workspace_id=$1 and memory_id=$2' using ws,target;
  end if;
  delete from public.search_chunks where workspace_id=ws and memory_id=target;
  delete from public.memory_overrides where workspace_id=ws and memory_id=target;
  -- Remove references to deleted claims in other histories, without retaining
  -- semantic content from the evidence being erased.
  update public.claim_revisions set supersedes_claim_id=null where workspace_id=ws
    and supersedes_claim_id in (select id from public.claims where workspace_id=ws and memory_id=target);
  delete from public.claim_revisions where workspace_id=ws and memory_id=target;
  delete from public.claims where workspace_id=ws and memory_id=target;
  delete from public.actions where workspace_id=ws and memory_id=target;
  select array_agg(distinct entity_id) into proposed_ids from public.mentions
    where workspace_id=ws and memory_id=target;
  delete from public.mentions where workspace_id=ws and memory_id=target;
  -- Erase identity proposals supported only by the removed evidence. Explicit
  -- user identities stay user-owned, independently of this capture. An entity
  -- named by an accepted merge/split history is also retained: deleting it
  -- would either break that immutable user decision or force the audit record
  -- to be erased as a side effect of deleting one memory.
  delete from public.entity_links where workspace_id=ws and (from_entity_id in
    (select id from public.entities e where workspace_id=ws and id=any(proposed_ids) and created_by is null
      and not exists(select 1 from public.mentions mn where mn.workspace_id=ws and mn.entity_id=e.id))
    or to_entity_id in (select id from public.entities e where workspace_id=ws and id=any(proposed_ids)
      and created_by is null and not exists(select 1 from public.mentions mn where mn.workspace_id=ws and mn.entity_id=e.id)));
  delete from public.entity_aliases where workspace_id=ws and entity_id in
    (select id from public.entities e where workspace_id=ws and id=any(proposed_ids) and created_by is null
      and not exists(select 1 from public.mentions mn where mn.workspace_id=ws and mn.entity_id=e.id)
      and not exists(select 1 from public.identity_operations io where io.workspace_id=ws
        and (io.source_entity_id=e.id or io.target_entity_id=e.id)));
  delete from public.entities e where workspace_id=ws and id=any(proposed_ids) and created_by is null
    and not exists(select 1 from public.mentions mn where mn.workspace_id=ws and mn.entity_id=e.id)
    and not exists(select 1 from public.identity_operations io where io.workspace_id=ws
      and (io.source_entity_id=e.id or io.target_entity_id=e.id));
  delete from public.memory_revisions where workspace_id=ws and memory_id=target;
  delete from public.memories where workspace_id=ws and id=target;
  perform set_config('app.recall_purge',previous_mode,true);
end $$;
revoke all on function recall_purge_memory(uuid) from public;

create function recall_purge_capture(target uuid, expected integer) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; version_now integer; mem uuid; source_ids uuid[]; previous_mode text;
begin
  ws := public.recall_current_workspace_id();
  if not public.recall_is_member(ws) then raise exception 'not authorized' using errcode='insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:' || ws::text,0));
  select version into version_now from public.captures where workspace_id=ws and id=target for update;
  if version_now is null then raise exception 'capture not found' using errcode='no_data_found'; end if;
  if version_now <> expected then raise exception 'version conflict' using errcode='serialization_failure'; end if;
  previous_mode := coalesce(current_setting('app.recall_purge',true),'');
  perform set_config('app.recall_purge',ws::text,true);
  select array_agg(id) into source_ids from public.source_objects where workspace_id=ws and capture_id=target;
  insert into public.object_purge_jobs(id,workspace_id,source_id,storage_key)
    select gen_random_uuid(),workspace_id,id,storage_key from public.source_objects
    where workspace_id=ws and capture_id=target on conflict do nothing;
  -- Relationships retain only evidence from surviving originals.
  update public.entity_links l set evidence=coalesce((select jsonb_agg(ev) from jsonb_array_elements(l.evidence) ev
    where not ((ev->>'page_id')::uuid=any(source_ids))),'[]'::jsonb),version=version+1
    where l.workspace_id=ws and exists(select 1 from jsonb_array_elements(l.evidence) ev
      where (ev->>'page_id')::uuid=any(source_ids));
  delete from public.entity_links where workspace_id=ws and evidence='[]'::jsonb and status='candidate';
  for mem in select id from public.memories where workspace_id=ws and capture_id=target loop
    perform public.recall_purge_memory(mem);
  end loop;
  update public.ai_usage set job_id=null where workspace_id=ws and job_id in
    (select id from public.processing_jobs where workspace_id=ws and capture_id=target);
  delete from public.processing_jobs where workspace_id=ws and capture_id=target;
  delete from public.source_objects where workspace_id=ws and capture_id=target;
  delete from public.memory_suppressions where workspace_id=ws and capture_id=target;
  delete from public.captures where workspace_id=ws and id=target;
  perform set_config('app.recall_purge',previous_mode,true);
end $$;
revoke all on function recall_purge_capture(uuid,integer) from public;
grant execute on function recall_purge_capture(uuid,integer) to recall_app;

create function recall_delete_memory(target uuid, expected integer) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; cap uuid; version_now integer; previous_mode text;
begin
  ws := public.recall_current_workspace_id();
  if not public.recall_is_member(ws) then raise exception 'not authorized' using errcode='insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:'||ws::text,0));
  select capture_id,current_revision into cap,version_now from public.memories where workspace_id=ws and id=target for update;
  if version_now is null then raise exception 'memory not found' using errcode='no_data_found'; end if;
  if version_now<>expected then raise exception 'version conflict' using errcode='serialization_failure'; end if;
  perform public.recall_purge_memory(target);
  previous_mode:=coalesce(current_setting('app.recall_purge',true),'');
  perform set_config('app.recall_purge',ws::text,true);
  update public.processing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,
    last_error_code='MEMORY_DELETED',finished_at=now(),updated_at=now()
    where workspace_id=ws and capture_id=cap and status in ('queued','leased');
  insert into public.memory_suppressions(workspace_id,capture_id,deleted_by) values(ws,cap,public.recall_current_user_id()) on conflict do nothing;
  update public.captures set status='stored',version=version+1 where workspace_id=ws and id=cap;
  perform set_config('app.recall_purge',previous_mode,true);
end $$;
revoke all on function recall_delete_memory(uuid,integer) from public;
grant execute on function recall_delete_memory(uuid,integer) to recall_app;

create function recall_purge_source(target uuid, expected_capture_version integer) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; cap uuid; version_now integer; mem uuid; previous_mode text; remaining integer;
begin
  ws:=public.recall_current_workspace_id();
  if not public.recall_is_member(ws) then raise exception 'not authorized' using errcode='insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:'||ws::text,0));
  select capture_id into cap from public.source_objects where workspace_id=ws and id=target;
  if cap is null then raise exception 'source not found' using errcode='no_data_found'; end if;
  select version into version_now from public.captures where workspace_id=ws and id=cap for update;
  if version_now<>expected_capture_version then raise exception 'version conflict' using errcode='serialization_failure'; end if;
  select count(*) into remaining from public.source_objects where workspace_id=ws and capture_id=cap;
  if remaining=1 then perform public.recall_purge_capture(cap,expected_capture_version); return; end if;
  -- Partial page erasure would otherwise erase a whole memory and its surviving-page
  -- user corrections. Until revision-level source subtraction is implemented, reject it.
  if exists(select 1 from public.memories where workspace_id=ws and capture_id=cap) then
    raise exception 'partial source deletion requires a capture without derived memory' using errcode='feature_not_supported';
  end if;
  previous_mode:=coalesce(current_setting('app.recall_purge',true),'');
  perform set_config('app.recall_purge',ws::text,true);
  insert into public.object_purge_jobs(id,workspace_id,source_id,storage_key)
    select gen_random_uuid(),workspace_id,id,storage_key from public.source_objects
    where workspace_id=ws and id=target on conflict do nothing;
  for mem in select id from public.memories where workspace_id=ws and capture_id=cap loop
    perform public.recall_purge_memory(mem);
  end loop;
  update public.entity_links l set evidence=coalesce((select jsonb_agg(ev) from jsonb_array_elements(l.evidence) ev
    where ev->>'page_id'<>target::text),'[]'::jsonb),version=version+1 where l.workspace_id=ws
      and exists(select 1 from jsonb_array_elements(l.evidence) ev where ev->>'page_id'=target::text);
  delete from public.entity_links where workspace_id=ws and evidence='[]'::jsonb and status='candidate';
  update public.processing_jobs set status='cancelled',lease_token=null,lease_expires_at=null,
    last_error_code='SOURCE_DELETED',finished_at=now(),updated_at=now() where workspace_id=ws and capture_id=cap;
  delete from public.source_objects where workspace_id=ws and id=target;
  update public.captures set status='stored',version=version+1 where workspace_id=ws and id=cap;
  perform set_config('app.recall_purge',previous_mode,true);
end $$;
revoke all on function recall_purge_source(uuid,integer) from public;
grant execute on function recall_purge_source(uuid,integer) to recall_app;

-- Erase workspace-owned content while retaining the minimal authenticated
-- workspace, monotonic tombstones and idempotency digests needed to prevent
-- disconnected devices from resurrecting deleted captures.
create function recall_erase_workspace(expected_clock bigint) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; tick bigint; cap record; previous_mode text;
begin
  ws:=public.recall_current_workspace_id();
  if not public.recall_is_member(ws) or not exists(select 1 from public.workspace_members
    where workspace_id=ws and user_id=public.recall_current_user_id() and role='owner') then
    raise exception 'owner required' using errcode='insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:'||ws::text,0));
  select sync_clock into tick from public.workspaces where id=ws;
  if tick<>expected_clock then raise exception 'version conflict' using errcode='serialization_failure'; end if;
  previous_mode:=coalesce(current_setting('app.recall_purge',true),'');
  perform set_config('app.recall_purge',ws::text,true);
  for cap in select id,version from public.captures where workspace_id=ws order by id loop
    perform public.recall_purge_capture(cap.id,cap.version);
  end loop;
  delete from public.entity_links where workspace_id=ws;
  delete from public.identity_operations where workspace_id=ws;
  delete from public.entity_aliases where workspace_id=ws;
  delete from public.entities where workspace_id=ws;
  delete from public.ai_usage where workspace_id=ws;
  delete from public.embedding_reservations where workspace_id=ws;
  delete from public.retrieval_index_config where workspace_id=ws;
  delete from public.devices where workspace_id=ws;
  update public.ai_consents set enabled=false,decided_at=now(),version=version+1 where workspace_id=ws;
  update public.workspaces set name='Personal' where id=ws;
  perform set_config('app.recall_purge',previous_mode,true);
end $$;
revoke all on function recall_erase_workspace(bigint) from public;
grant execute on function recall_erase_workspace(bigint) to recall_app;
