-- Operational receipts only: no original bytes or canonical memories. Digests survive expiry
-- so a lost response, restart, erasure or delayed retry cannot repeat a dispatched operation.
create table local_reading_receipts (
 workspace_id uuid not null references workspaces(id),
 device_id uuid not null, vault_id uuid not null, operation_id uuid not null,
 binding jsonb not null, payload_sha256 text not null,
 state text not null check(state in ('in_flight','complete','failed','unknown','expired')),
 result jsonb, error_code text, reservation_id uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 primary key(workspace_id,device_id,vault_id,operation_id),
 check(result is null or octet_length(result::text)<=1048576)
);
alter table local_reading_receipts enable row level security;
alter table local_reading_receipts force row level security;
create policy local_reading_member on local_reading_receipts for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select,insert,update on local_reading_receipts to recall_app;
-- A narrow maintenance function can erase expired content without revealing it to another workspace.
do $$ begin
 execute format('create policy local_reading_maintenance on local_reading_receipts for all to %I using(true) with check(true)',current_user);
end $$;
create function recall_expire_local_readings() returns void language sql security definer
set search_path=pg_catalog,public as $$
 update public.local_reading_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
 where expires_at<=now() and state<>'expired';
 update public.local_reading_receipts set state='unknown',error_code='PROVIDER_OUTCOME_UNKNOWN'
 where state='in_flight' and created_at<now()-interval '15 minutes';
$$;
revoke all on function recall_expire_local_readings() from public;
grant execute on function recall_expire_local_readings() to recall_app;
-- Existing workspace erasure ends with a workspace update while its scoped purge flag is set.
-- Preserve only receipt metadata, fence any late in-flight completion and discard reading content.
create function recall_erase_local_readings() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
 if public.recall_purge_active() then
  update public.local_reading_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
  where workspace_id=new.id;
 end if;
 return new;
end $$;
revoke all on function recall_erase_local_readings() from public;
create trigger erase_local_readings after update on workspaces
 for each row execute function recall_erase_local_readings();
-- The API may settle this interpretation only against an admitted local receipt. Existing
-- cloud worker interpretation privileges and API answer policy remain unchanged.
create policy local_reading_usage on ai_usage for insert to recall_app
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)
 and purpose='interpret' and job_id is null and exists(
 select 1 from local_reading_receipts r where r.workspace_id=ai_usage.workspace_id ));
