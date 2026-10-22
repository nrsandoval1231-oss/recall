-- Remembered organization consent is independent from Ask and selected-photo consent.
alter table embedding_reservations drop constraint if exists embedding_reservations_purpose_check;
alter table embedding_reservations add constraint embedding_reservations_purpose_check
 check(purpose in ('query','document','interpret','repair','answer','organize'));
alter table ai_usage drop constraint if exists ai_usage_purpose_check;
alter table ai_usage add constraint ai_usage_purpose_check
 check(purpose in ('interpret','repair','answer','embedding','organize'));

create table vault_intelligence_organize_consents (
 workspace_id uuid not null references workspaces(id),
 device_id uuid not null,
 vault_id uuid not null,
 enabled boolean not null default false,
 policy_version text not null check(octet_length(policy_version)<=160),
 decided_by uuid not null,
 decided_at timestamptz not null default now(),
 consent_epoch integer not null check(consent_epoch>=0),
 primary key(workspace_id,device_id,vault_id),
 foreign key(workspace_id,decided_by) references workspace_members(workspace_id,user_id)
);
alter table vault_intelligence_organize_consents enable row level security;
alter table vault_intelligence_organize_consents force row level security;
create policy vault_intelligence_organize_consent_member on vault_intelligence_organize_consents for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id)
 and decided_by=recall_current_user_id());
grant select,insert on vault_intelligence_organize_consents to recall_app;
grant update(enabled,policy_version,decided_by,decided_at,consent_epoch) on vault_intelligence_organize_consents to recall_app;
do $$ begin
 execute format('create policy vault_intelligence_organize_consent_owner on vault_intelligence_organize_consents for all to %I using(true) with check(true)',current_user);
end $$;

create table local_organization_receipts (
 workspace_id uuid not null references workspaces(id),
 device_id uuid not null, vault_id uuid not null, operation_id uuid not null,
 binding jsonb not null, payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('in_flight','unknown','complete','failed','expired')),
 result jsonb, error_code text, reservation_id uuid,
 consent_policy_version text not null, consent_epoch integer not null check(consent_epoch>0),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 primary key(workspace_id,device_id,vault_id,operation_id),
 check(result is null or octet_length(result::text)<=900000),
 check((state='complete')=(result is not null))
);
alter table local_organization_receipts enable row level security;
alter table local_organization_receipts force row level security;
create policy local_organization_receipts_member on local_organization_receipts for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select,insert,update on local_organization_receipts to recall_app;
create policy local_organization_usage on ai_usage for insert to recall_app
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)
 and purpose='organize' and job_id is null and exists(
 select 1 from local_organization_receipts r where r.workspace_id=ai_usage.workspace_id));
do $$ begin
 execute format('create policy local_organization_receipts_owner on local_organization_receipts for all to %I using(true) with check(true)',current_user);
end $$;
create function recall_expire_local_organizations() returns void language sql security definer
 set search_path=pg_catalog,public as $$
 update public.local_organization_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
 where expires_at<=now() and state='in_flight';
 update public.local_organization_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
 where expires_at<=now() and state not in ('expired','in_flight');
 update public.local_organization_receipts set state='unknown',error_code='PROVIDER_OUTCOME_UNKNOWN'
 where state='in_flight' and created_at<now()-interval '15 minutes';
$$;
revoke all on function recall_expire_local_organizations() from public;
grant execute on function recall_expire_local_organizations() to recall_app;

create or replace function recall_erase_local_intelligence() returns trigger language plpgsql security definer
 set search_path=pg_catalog,public as $$
begin
 if public.recall_purge_active() then
  update public.vault_intelligence_pair_grants set revoked_at=now() where workspace_id=new.id and revoked_at is null;
  update public.vault_intelligence_ask_consents set enabled=false,decided_at=now(),version=version+1 where workspace_id=new.id;
  update public.vault_intelligence_organize_consents set enabled=false,decided_at=now(),consent_epoch=consent_epoch+1 where workspace_id=new.id;
  update public.local_intelligence_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED' where workspace_id=new.id;
  update public.local_organization_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED' where workspace_id=new.id;
 end if;
 return new;
end $$;
