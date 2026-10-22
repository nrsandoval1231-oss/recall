-- A separate owner-approved capability for selected vault text used by local Ask.
-- It deliberately does not reuse photo_inference grants or ai_consents.
create table vault_intelligence_pair_invitations (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 user_id uuid not null,
 device_id uuid not null,
 vault_id uuid not null,
 secret_sha256 text not null check(secret_sha256 ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(id, workspace_id)
);
create table vault_intelligence_pair_grants (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 user_id uuid not null,
 device_id uuid not null,
 vault_id uuid not null,
 secret_sha256 text not null unique check(secret_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 foreign key(workspace_id, user_id) references workspace_members(workspace_id,user_id)
);
alter table vault_intelligence_pair_invitations enable row level security;
alter table vault_intelligence_pair_invitations force row level security;
alter table vault_intelligence_pair_grants enable row level security;
alter table vault_intelligence_pair_grants force row level security;
create policy vault_intelligence_invitation_no_api on vault_intelligence_pair_invitations for all to recall_app
 using(false) with check(false);
create policy vault_intelligence_grant_no_api on vault_intelligence_pair_grants for all to recall_app
 using(false) with check(false);
do $$ begin
 execute format('create policy vault_intelligence_invitation_owner on vault_intelligence_pair_invitations for all to %I using(true) with check(true)',current_user);
 execute format('create policy vault_intelligence_grant_owner on vault_intelligence_pair_grants for all to %I using(true) with check(true)',current_user);
end $$;

create function recall_vault_intelligence_auth(p_secret_sha256 text) returns table
 (user_id uuid, workspace_id uuid, device_id uuid, vault_id uuid)
 language sql stable security definer set search_path=pg_catalog,public as $$
 select g.user_id,g.workspace_id,g.device_id,g.vault_id from public.vault_intelligence_pair_grants g
 join public.workspace_members m on m.workspace_id=g.workspace_id and m.user_id=g.user_id and m.role='owner'
 where g.secret_sha256=p_secret_sha256 and g.revoked_at is null
$$;
revoke all on function recall_vault_intelligence_auth(text) from public;
grant execute on function recall_vault_intelligence_auth(text) to recall_app;

create function recall_vault_intelligence_invite(p_user uuid,p_workspace uuid,p_device uuid,p_vault uuid,
 p_fingerprint text,p_ttl_seconds integer)
 returns table(invitation_id uuid,expires_at timestamptz)
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare result_id uuid:=gen_random_uuid(); expires timestamptz:=now()+make_interval(secs=>p_ttl_seconds);
begin
 if p_ttl_seconds<30 or p_ttl_seconds>900 or p_fingerprint !~ '^[0-9a-f]{64}$'
   or not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace
     and m.user_id=p_user and m.role='owner')
   or (select m.workspace_id from public.workspace_members m where m.user_id=p_user
     order by m.created_at,m.workspace_id limit 1) is distinct from p_workspace then
   raise exception 'owner workspace binding or invitation parameters invalid';
 end if;
 insert into public.vault_intelligence_pair_invitations(id,workspace_id,user_id,device_id,vault_id,secret_sha256,expires_at)
 values(result_id,p_workspace,p_user,p_device,p_vault,p_fingerprint,expires);
 return query select result_id,expires;
end $$;
revoke all on function recall_vault_intelligence_invite(uuid,uuid,uuid,uuid,text,integer) from public;

create function recall_vault_intelligence_claim(p_id uuid, p_secret_sha256 text)
 returns table(device_id uuid, vault_id uuid, scope text)
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.vault_intelligence_pair_invitations;
begin
 select * into i from public.vault_intelligence_pair_invitations where id=p_id for update;
 if not found or i.claimed_at is not null or i.expires_at<=now()
   or i.secret_sha256<>p_secret_sha256 then raise exception 'intelligence invitation unavailable'; end if;
 if not exists(select 1 from public.workspace_members m where m.workspace_id=i.workspace_id
   and m.user_id=i.user_id and m.role='owner') then raise exception 'pairing owner membership changed'; end if;
 insert into public.vault_intelligence_pair_grants(id,workspace_id,user_id,device_id,vault_id,secret_sha256)
 values(gen_random_uuid(),i.workspace_id,i.user_id,i.device_id,i.vault_id,i.secret_sha256);
 update public.vault_intelligence_pair_invitations set claimed_at=now() where id=p_id;
 return query select i.device_id,i.vault_id,'vault_intelligence'::text;
end $$;
revoke all on function recall_vault_intelligence_claim(uuid,text) from public;
grant execute on function recall_vault_intelligence_claim(uuid,text) to recall_app;

create function recall_vault_intelligence_revoke(p_secret_sha256 text) returns boolean
 language sql security definer set search_path=pg_catalog,public as $$
 with changed as (update public.vault_intelligence_pair_grants set revoked_at=now()
   where secret_sha256=p_secret_sha256 and revoked_at is null returning 1)
 select exists(select 1 from changed) or exists(select 1 from public.vault_intelligence_pair_grants where secret_sha256=p_secret_sha256)
$$;
revoke all on function recall_vault_intelligence_revoke(text) from public;
grant execute on function recall_vault_intelligence_revoke(text) to recall_app;
create function recall_vault_intelligence_owner_revoke(p_user uuid,p_workspace uuid,p_device uuid,p_vault uuid)
 returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace
   and m.user_id=p_user and m.role='owner')
   or (select m.workspace_id from public.workspace_members m where m.user_id=p_user
     order by m.created_at,m.workspace_id limit 1) is distinct from p_workspace then
   raise exception 'owner workspace binding invalid';
 end if;
 update public.vault_intelligence_pair_grants set revoked_at=coalesce(revoked_at,now())
  where workspace_id=p_workspace and device_id=p_device and vault_id=p_vault;
 return exists(select 1 from public.vault_intelligence_pair_grants where workspace_id=p_workspace
  and device_id=p_device and vault_id=p_vault);
end $$;
revoke all on function recall_vault_intelligence_owner_revoke(uuid,uuid,uuid,uuid) from public;

-- Ask consent has its own version and revocation state; legacy/photo consent cannot satisfy it.
create function recall_is_owner(p_workspace uuid) returns boolean
 language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace
   and m.user_id=public.recall_current_user_id() and m.role='owner')
$$;
revoke all on function recall_is_owner(uuid) from public;
grant execute on function recall_is_owner(uuid) to recall_app;
create table vault_intelligence_ask_consents (
 workspace_id uuid primary key references workspaces(id),
 enabled boolean not null default false,
 policy_version text not null,
 decided_by uuid not null,
 decided_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 foreign key(workspace_id,decided_by) references workspace_members(workspace_id,user_id)
);
alter table vault_intelligence_ask_consents enable row level security;
alter table vault_intelligence_ask_consents force row level security;
create policy vault_intelligence_ask_consent_member on vault_intelligence_ask_consents for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_owner(workspace_id)
 and decided_by=recall_current_user_id());
grant select,insert on vault_intelligence_ask_consents to recall_app;
grant update(enabled,policy_version,decided_by,decided_at,version) on vault_intelligence_ask_consents to recall_app;
do $$ begin
 execute format('create policy vault_intelligence_ask_consent_owner on vault_intelligence_ask_consents for all to %I using(true) with check(true)',current_user);
end $$;

create table local_intelligence_receipts (
 workspace_id uuid not null references workspaces(id),
 device_id uuid not null, vault_id uuid not null, operation_id uuid not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('in_flight','unknown','complete','failed','expired')),
 result jsonb, error_code text, reservation_id uuid, consent_required boolean not null default true,
 consent_policy_version text, consent_version integer check(consent_version is null or consent_version>0),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 primary key(workspace_id,device_id,vault_id,operation_id),
 check(result is null or octet_length(result::text)<=32768),
 check((state='complete')=(result is not null)),
 check((consent_required and consent_policy_version is not null and consent_version is not null)
    or (not consent_required and consent_policy_version is null and consent_version is null))
);
alter table local_intelligence_receipts enable row level security;
alter table local_intelligence_receipts force row level security;
create policy local_intelligence_receipts_member on local_intelligence_receipts for all to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
grant select,insert,update on local_intelligence_receipts to recall_app;
do $$ begin
 execute format('create policy local_intelligence_receipts_owner on local_intelligence_receipts for all to %I using(true) with check(true)',current_user);
end $$;
create function recall_expire_local_intelligence() returns void language sql security definer
 set search_path=pg_catalog,public as $$
 update public.local_intelligence_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
 where expires_at<=now() and state='in_flight';
 update public.local_intelligence_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED'
 where expires_at<=now() and state not in ('expired','in_flight');
 update public.local_intelligence_receipts set state='unknown',error_code='PROVIDER_OUTCOME_UNKNOWN'
 where state='in_flight' and created_at<now()-interval '15 minutes';
$$;
revoke all on function recall_expire_local_intelligence() from public;
grant execute on function recall_expire_local_intelligence() to recall_app;

create function recall_erase_local_intelligence() returns trigger language plpgsql security definer
 set search_path=pg_catalog,public as $$
begin
 if public.recall_purge_active() then
  update public.vault_intelligence_pair_grants set revoked_at=now() where workspace_id=new.id and revoked_at is null;
  update public.vault_intelligence_ask_consents set enabled=false,decided_at=now(),version=version+1 where workspace_id=new.id;
  update public.local_intelligence_receipts set state='expired',result=null,error_code='RECEIPT_EXPIRED' where workspace_id=new.id;
 end if;
 return new;
end $$;
revoke all on function recall_erase_local_intelligence() from public;
create trigger erase_local_intelligence after update on workspaces
 for each row execute function recall_erase_local_intelligence();
