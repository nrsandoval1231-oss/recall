-- RCL-001 Trusted Capture: users -> workspaces -> devices -> captures -> source objects.
-- Only the tables this packet needs. Run as the database OWNER role; the API connects
-- as a separate non-owner login role that inherits `recall_app` (see docs/DEVELOPMENT.md).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'recall_app') then
    create role recall_app nologin nosuperuser nobypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Request context. Set transaction-locally by the API (set_config(..., true)).
-- ---------------------------------------------------------------------------
create function recall_current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function recall_current_workspace_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table workspaces (
  id                uuid primary key,
  name              text not null check (char_length(name) between 1 and 200),
  created_by        uuid not null,
  -- one personal workspace per user; NULL for any future shared workspace
  personal_for_user uuid unique,
  created_at        timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id),
  user_id      uuid not null,
  role         text not null check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members (user_id);

-- Membership test used by every workspace-scoped policy. SECURITY DEFINER so it is not
-- inlined into (and does not recurse through) policy expansion; the members policy still
-- restricts it to the caller's own rows.
create function recall_is_member(ws uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
begin
  return exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = recall_current_user_id()
  );
end $$;

create table devices (
  workspace_id uuid not null references workspaces(id),
  id           uuid not null,                       -- client-generated device UUID
  user_id      uuid not null,
  platform     text not null check (platform in ('ios', 'android', 'windows', 'macos', 'linux', 'web')),
  name         text check (name is null or char_length(name) <= 200),
  app_version  text check (app_version is null or char_length(app_version) <= 50),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table captures (
  id                uuid primary key,               -- server-assigned canonical ID
  workspace_id      uuid not null references workspaces(id),
  client_capture_id uuid not null,
  device_id         uuid not null,
  created_by        uuid not null,
  source_kind       text not null check (source_kind in ('handwritten_note', 'photo_document')),
  captured_at       timestamptz not null,
  timezone          text not null check (char_length(timezone) between 1 and 100),
  context_hint      text check (context_hint is null or char_length(context_hint) <= 2000),
  page_count        smallint not null check (page_count between 1 and 10),
  -- RCL-001 ends at 'stored'. processing/ready/needs_review/failed belong to RCL-002.
  status            text not null default 'awaiting_upload'
                      check (status in ('awaiting_upload', 'stored')),
  request_digest    text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  stored_at         timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, client_capture_id),
  foreign key (workspace_id, device_id) references devices (workspace_id, id),
  check ((status = 'stored') = (stored_at is not null))
);
create index captures_recent_idx on captures (workspace_id, created_at desc, id desc);

create table source_objects (
  id                 uuid primary key,              -- server-assigned canonical source ID
  workspace_id       uuid not null references workspaces(id),
  capture_id         uuid not null,
  client_page_id     uuid not null,
  ordinal            smallint not null check (ordinal between 1 and 10),
  media_type         text not null check (media_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  declared_byte_size integer not null check (declared_byte_size between 1 and 26214400),
  declared_sha256    text not null check (declared_sha256 ~ '^[a-f0-9]{64}$'),
  original_filename  text check (original_filename is null or char_length(original_filename) <= 255),
  -- server-assigned; never derived from client input
  storage_key        text not null unique,
  -- authoritative values, computed by the server from received bytes
  received_at        timestamptz,
  received_byte_size integer,
  server_sha256      text check (server_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at        timestamptz,
  created_at         timestamptz not null default now(),
  foreign key (workspace_id, capture_id) references captures (workspace_id, id),
  unique (capture_id, ordinal),
  unique (capture_id, client_page_id),
  check ((received_at is null) = (server_sha256 is null)),
  check ((received_at is null) = (received_byte_size is null)),
  check (verified_at is null or received_at is not null),
  -- the server hash must equal what the manifest promised, or nothing is stored
  check (server_sha256 is null or server_sha256 = declared_sha256),
  check (received_byte_size is null or received_byte_size = declared_byte_size)
);
create index source_objects_capture_idx on source_objects (capture_id, ordinal);

create table idempotency_records (
  workspace_id     uuid not null references workspaces(id),
  actor_id         uuid not null,
  operation_family text not null check (operation_family in ('capture.create', 'capture.finalize')),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest   text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  resource_id      uuid not null,
  created_at       timestamptz not null default now(),
  primary key (workspace_id, actor_id, operation_family, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Integrity triggers (defence in depth: hold even for the table owner)
-- ---------------------------------------------------------------------------
create function recall_captures_guard() returns trigger language plpgsql as $$
declare verified integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'captures are not deletable in RCL-001' using errcode = 'restrict_violation';
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
  if old.status = 'stored' and new.status <> 'stored' then
    raise exception 'stored captures cannot regress' using errcode = 'restrict_violation';
  end if;
  if new.status = 'stored' and old.status <> 'stored' then
    select count(*) into verified from source_objects s
      where s.capture_id = new.id and s.verified_at is not null
        and s.server_sha256 is not null;
    if verified <> new.page_count then
      raise exception 'capture cannot be stored: % of % pages verified', verified, new.page_count
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger captures_guard before update or delete on captures
  for each row execute function recall_captures_guard();

create function recall_source_objects_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'source objects are append-only in RCL-001' using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.capture_id is distinct from old.capture_id
     or new.client_page_id is distinct from old.client_page_id
     or new.ordinal is distinct from old.ordinal
     or new.media_type is distinct from old.media_type
     or new.declared_byte_size is distinct from old.declared_byte_size
     or new.declared_sha256 is distinct from old.declared_sha256
     or new.storage_key is distinct from old.storage_key then
    raise exception 'immutable source field changed' using errcode = 'restrict_violation';
  end if;
  -- an accepted original is never silently replaced
  if old.server_sha256 is not null and (
       new.server_sha256 is distinct from old.server_sha256
       or new.received_byte_size is distinct from old.received_byte_size
       or new.received_at is distinct from old.received_at) then
    raise exception 'accepted original is write-once' using errcode = 'restrict_violation';
  end if;
  if old.verified_at is not null and new.verified_at is distinct from old.verified_at then
    raise exception 'verification is write-once' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger source_objects_guard before update or delete on source_objects
  for each row execute function recall_source_objects_guard();

-- ---------------------------------------------------------------------------
-- Row-level security. FORCE so the owner is bound too (superusers still bypass).
-- ---------------------------------------------------------------------------
alter table workspaces          enable row level security;
alter table workspace_members   enable row level security;
alter table devices             enable row level security;
alter table captures            enable row level security;
alter table source_objects      enable row level security;
alter table idempotency_records enable row level security;
alter table workspaces          force row level security;
alter table workspace_members   force row level security;
alter table devices             force row level security;
alter table captures            force row level security;
alter table source_objects      force row level security;
alter table idempotency_records force row level security;

create policy workspaces_select on workspaces for select
  using (created_by = recall_current_user_id() or recall_is_member(id));
create policy workspaces_insert on workspaces for insert
  with check (created_by = recall_current_user_id()
              and (personal_for_user is null or personal_for_user = recall_current_user_id()));

create policy members_select on workspace_members for select
  using (user_id = recall_current_user_id());
create policy members_insert on workspace_members for insert
  with check (
    user_id = recall_current_user_id() and role = 'owner'
    and exists (select 1 from workspaces w
                where w.id = workspace_id and w.created_by = recall_current_user_id())
  );

-- Every workspace-scoped row requires BOTH the request's selected workspace AND live membership.
create policy devices_all on devices for all
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id)
              and user_id = recall_current_user_id());
create policy captures_all on captures for all
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy source_objects_all on source_objects for all
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id))
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id));
create policy idempotency_all on idempotency_records for all
  using (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id)
         and actor_id = recall_current_user_id())
  with check (workspace_id = recall_current_workspace_id() and recall_is_member(workspace_id)
              and actor_id = recall_current_user_id());

-- ---------------------------------------------------------------------------
-- Least privilege for the request role. No DELETE/TRUNCATE anywhere.
-- ---------------------------------------------------------------------------
grant usage on schema public to recall_app;
grant select, insert on workspaces, workspace_members to recall_app;
grant select, insert on devices to recall_app;
grant update (name, app_version, last_seen_at) on devices to recall_app;
grant select, insert on captures, source_objects, idempotency_records to recall_app;
grant update (status, stored_at, version) on captures to recall_app;
grant update (received_at, received_byte_size, server_sha256, verified_at) on source_objects to recall_app;
