-- Remembered voice-transcript organization consent is independent from Ask, selected-photo and text/photo
-- organization consent. The shared organization receipts and the `organize` provider-budget purpose are reused.
create table vault_intelligence_audio_organize_consents (
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
alter table vault_intelligence_audio_organize_consents enable row level security;
alter table vault_intelligence_audio_organize_consents force row level security;
create policy vault_intelligence_audio_organize_consent_member on vault_intelligence_audio_organize_consents for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id)
 and decided_by=recall_current_user_id());
grant select,insert on vault_intelligence_audio_organize_consents to recall_app;
grant update(enabled,policy_version,decided_by,decided_at,consent_epoch) on vault_intelligence_audio_organize_consents to recall_app;
do $$ begin
 execute format('create policy vault_intelligence_audio_organize_consent_owner on vault_intelligence_audio_organize_consents for all to %I using(true) with check(true)',current_user);
end $$;

create or replace function recall_erase_local_intelligence() returns trigger language plpgsql security definer
 set search_path=pg_catalog,public as $$
begin
 if public.recall_purge_active() then
  update public.vault_intelligence_pair_grants set revoked_at=now() where workspace_id=new.id and revoked_at is null;
  update public.vault_intelligence_ask_consents set enabled=false,decided_at=now(),version=version+1 where workspace_id=new.id;
  update public.vault_intelligence_organize_consents set enabled=false,decided_at=now(),consent_epoch=consent_epoch+1 where workspace_id=new.id;
  update public.vault_intelligence_audio_organize_consents set enabled=false,decided_at=now(),consent_epoch=consent_epoch+1 where workspace_id=new.id;
  update public.local_intelligence_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED' where workspace_id=new.id;
  update public.local_organization_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED' where workspace_id=new.id;
 end if;
 return new;
end $$;
