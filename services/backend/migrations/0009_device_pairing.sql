-- Owner-approved, inference-only device credentials. Invitation and credential digests only.
create table device_pair_invitations (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 user_id uuid not null,
 device_id uuid not null,
 vault_id uuid not null,
 secret_sha256 text not null check(secret_sha256 ~ '^[0-9a-f]{64}$'),
 scope text not null check(scope='photo_inference'),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(id, workspace_id)
);
create table device_pair_grants (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 user_id uuid not null,
 device_id uuid not null,
 vault_id uuid not null,
 secret_sha256 text not null unique check(secret_sha256 ~ '^[0-9a-f]{64}$'),
 scope text not null check(scope='photo_inference'),
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 foreign key(workspace_id, user_id) references workspace_members(workspace_id,user_id)
);
alter table device_pair_invitations enable row level security;
alter table device_pair_invitations force row level security;
alter table device_pair_grants enable row level security;
alter table device_pair_grants force row level security;
create policy device_pair_invitation_no_api on device_pair_invitations for all to recall_app
 using(false) with check(false);
create policy device_pair_grant_no_api on device_pair_grants for all to recall_app
 using(false) with check(false);
do $$ begin
 execute format('create policy device_pair_invitation_owner on device_pair_invitations for all to %I using(true) with check(true)',current_user);
 execute format('create policy device_pair_grant_owner on device_pair_grants for all to %I using(true) with check(true)',current_user);
 execute format('create policy device_pair_membership_owner_read on workspace_members for select to %I using(true)',current_user);
end $$;
-- Hash authentication returns only a scoped principal and rechecks revocation each request.
create function recall_device_pair_auth(p_secret_sha256 text) returns table
 (user_id uuid, workspace_id uuid, device_id uuid, vault_id uuid)
 language sql stable security definer set search_path=pg_catalog,public as $$
 select g.user_id,g.workspace_id,g.device_id,g.vault_id from public.device_pair_grants g
 join public.workspace_members m on m.workspace_id=g.workspace_id and m.user_id=g.user_id and m.role='owner'
 where g.secret_sha256=p_secret_sha256 and g.scope='photo_inference' and g.revoked_at is null
$$;
revoke all on function recall_device_pair_auth(text) from public;
grant execute on function recall_device_pair_auth(text) to recall_app;
create function recall_device_pair_invite(p_user uuid,p_workspace uuid,p_device uuid,p_vault uuid,
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
 insert into public.device_pair_invitations(id,workspace_id,user_id,device_id,vault_id,secret_sha256,scope,expires_at)
 values(result_id,p_workspace,p_user,p_device,p_vault,p_fingerprint,'photo_inference',expires);
 return query select result_id,expires;
end $$;
revoke all on function recall_device_pair_invite(uuid,uuid,uuid,uuid,text,integer) from public;
create function recall_device_pair_owner_revoke(p_user uuid,p_workspace uuid,p_device uuid,p_vault uuid)
 returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace
   and m.user_id=p_user and m.role='owner')
   or (select m.workspace_id from public.workspace_members m where m.user_id=p_user
     order by m.created_at,m.workspace_id limit 1) is distinct from p_workspace then
   raise exception 'owner workspace binding invalid';
 end if;
 update public.device_pair_grants set revoked_at=coalesce(revoked_at,now())
  where workspace_id=p_workspace and device_id=p_device and vault_id=p_vault and scope='photo_inference';
 return exists(select 1 from public.device_pair_grants where workspace_id=p_workspace
  and device_id=p_device and vault_id=p_vault and scope='photo_inference');
end $$;
revoke all on function recall_device_pair_owner_revoke(uuid,uuid,uuid,uuid) from public;
create function recall_device_pair_claim(p_id uuid, p_secret_sha256 text)
 returns table(device_id uuid, vault_id uuid, scope text)
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.device_pair_invitations;
begin
 select * into i from public.device_pair_invitations where id=p_id for update;
 if not found or i.claimed_at is not null or i.expires_at<=now()
   or i.secret_sha256<>p_secret_sha256 or i.scope<>'photo_inference' then
   raise exception 'pair invitation unavailable';
 end if;
 if not exists(select 1 from public.workspace_members m where m.workspace_id=i.workspace_id
   and m.user_id=i.user_id and m.role='owner') then
   raise exception 'pairing owner membership changed';
 end if;
 insert into public.device_pair_grants(id,workspace_id,user_id,device_id,vault_id,secret_sha256,scope)
 values(gen_random_uuid(),i.workspace_id,i.user_id,i.device_id,i.vault_id,i.secret_sha256,i.scope);
 update public.device_pair_invitations set claimed_at=now() where id=p_id;
 return query select i.device_id,i.vault_id,i.scope;
end $$;
revoke all on function recall_device_pair_claim(uuid,text) from public;
grant execute on function recall_device_pair_claim(uuid,text) to recall_app;
create function recall_device_pair_revoke(p_secret_sha256 text) returns boolean
 language sql security definer set search_path=pg_catalog,public as $$
 with changed as (update public.device_pair_grants set revoked_at=now()
   where secret_sha256=p_secret_sha256 and revoked_at is null returning 1)
 select exists(select 1 from changed) or exists(select 1 from public.device_pair_grants where secret_sha256=p_secret_sha256)
$$;
revoke all on function recall_device_pair_revoke(text) from public;
grant execute on function recall_device_pair_revoke(text) to recall_app;
create function recall_revoke_paired_devices() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
 if public.recall_purge_active() then
  update public.device_pair_grants set revoked_at=now()
   where workspace_id=new.id and revoked_at is null;
 end if;
 return new;
end $$;
revoke all on function recall_revoke_paired_devices() from public;
create trigger revoke_paired_devices after update on workspaces
 for each row execute function recall_revoke_paired_devices();
