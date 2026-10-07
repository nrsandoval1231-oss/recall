-- Workspace-serialized, commit-ordered cache feed. All content remains behind RLS.
alter table workspaces add column sync_clock bigint not null default 0;
alter table workspaces add column sync_floor bigint not null default 0;
alter table workspaces add constraint sync_clock_safe check (sync_clock between 0 and 9007199254740991);
create table change_events (
  workspace_id uuid not null references workspaces(id),
  sequence bigint not null,
  kind text not null,
  record_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, sequence)
);
alter table change_events enable row level security;
alter table change_events force row level security;
create policy change_events_member on change_events for select to recall_app
  using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select on change_events to recall_app;

-- FORCE RLS also binds the table owner executing the trigger. Only that
-- migration owner gets narrowly scoped clock/event policies; application
-- roles receive neither UPDATE(clock) nor INSERT(event) grants.
do $$ begin
  execute format('create policy sync_owner_clock_select on workspaces for select to %I using (id=recall_current_workspace_id())', current_user);
  execute format('create policy sync_owner_clock_update on workspaces for update to %I using (id=recall_current_workspace_id()) with check (id=recall_current_workspace_id())', current_user);
  execute format('create policy sync_owner_event_insert on change_events for insert to %I with check (workspace_id=recall_current_workspace_id())', current_user);
end $$;

-- This function only publishes the triggering row's identity. It cannot be
-- invoked as a normal function, and accepts no caller-selected workspace.
create function recall_publish_change() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare ws uuid; resource uuid; tick bigint;
begin
  if tg_op = 'DELETE' then ws := old.workspace_id; else ws := new.workspace_id; end if;
  if ws is distinct from public.recall_current_workspace_id() then
    raise exception 'invalid sync workspace' using errcode='insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then resource := (to_jsonb(old)->>tg_argv[1])::uuid;
  else resource := (to_jsonb(new)->>tg_argv[1])::uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended('sync:' || ws::text, 0));
  update public.workspaces set sync_clock=sync_clock+1 where id=ws returning sync_clock into tick;
  insert into public.change_events(workspace_id,sequence,kind,record_id)
    values(ws,tick,tg_argv[0],resource);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function recall_publish_change() from public;

create trigger captures_sync after insert or update or delete on captures
  for each row execute function recall_publish_change('capture','id');
create trigger sources_sync after insert or update or delete on source_objects
  for each row execute function recall_publish_change('source','id');
create trigger memories_sync after insert or update or delete on memories
  for each row execute function recall_publish_change('memory','id');
create trigger revisions_sync after insert on memory_revisions
  for each row execute function recall_publish_change('memory','memory_id');
create trigger entities_sync after insert or update or delete on entities
  for each row execute function recall_publish_change('entity','id');
create trigger aliases_sync after insert or update on entity_aliases
  for each row execute function recall_publish_change('entity','entity_id');
create trigger mentions_sync after insert or update on mentions
  for each row execute function recall_publish_change('memory','memory_id');
create trigger claims_sync after insert or update or delete on claims
  for each row execute function recall_publish_change('claim','id');
create trigger claims_memory_sync after insert or update on claims
  for each row execute function recall_publish_change('memory','memory_id');
create trigger claim_revision_sync after insert on claim_revisions
  for each row execute function recall_publish_change('claim','claim_id');
create trigger relationships_sync after insert or update or delete on entity_links
  for each row execute function recall_publish_change('relationship','id');
create trigger actions_sync after insert or update or delete on actions
  for each row execute function recall_publish_change('action','id');
create trigger actions_memory_sync after insert or update on actions
  for each row execute function recall_publish_change('memory','memory_id');
