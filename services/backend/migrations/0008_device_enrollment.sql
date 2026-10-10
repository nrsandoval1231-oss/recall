-- Pilot device enrollment. Operator-issued single-use capabilities and revocable
-- device sessions. recall_app has no table privileges here; the API role reaches
-- these rows only through SECURITY DEFINER functions owned by the migration role.
-- Token plaintext is never stored. Workspace tables keep forced RLS, so the
-- functions set the request user before creating a personal workspace.

create table device_enrollments (
  id                  uuid primary key,
  workspace_id        uuid not null references workspaces(id),
  user_id             uuid not null,
  token_hash          text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label               text check (label is null or char_length(label) between 1 and 80),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  consumed_session_id uuid,
  revoked_at          timestamptz,
  check (consumed_at is null or consumed_session_id is not null)
);

create table device_sessions (
  id            uuid primary key,
  workspace_id  uuid not null references workspaces(id),
  user_id       uuid not null,
  device_id     uuid,
  token_hash    text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_seen_at  timestamptz not null default now(),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 200)
);

create table auth_audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  action         text not null check (char_length(action) between 1 and 80),
  outcome        text not null check (char_length(outcome) between 1 and 40),
  workspace_id   uuid,
  user_id        uuid,
  session_id     uuid,
  enrollment_id  uuid,
  client_bucket  text check (client_bucket is null or char_length(client_bucket) <= 80),
  detail         text check (detail is null or char_length(detail) <= 200)
);

create table auth_rate_buckets (
  bucket         text primary key check (char_length(bucket) between 1 and 80),
  window_started timestamptz not null,
  hits           integer not null check (hits >= 0)
);

revoke all on device_enrollments, device_sessions, auth_audit_events, auth_rate_buckets from public;

create function recall_audit(
  p_action text,
  p_outcome text,
  p_workspace_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_enrollment_id uuid,
  p_client_bucket text,
  p_detail text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into auth_audit_events (
    action, outcome, workspace_id, user_id, session_id, enrollment_id, client_bucket, detail
  ) values (
    left(p_action, 80), left(p_outcome, 40), p_workspace_id, p_user_id, p_session_id,
    p_enrollment_id, left(p_client_bucket, 80), left(p_detail, 200)
  );
end $$;

create function recall_rate_allow(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 80
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  insert into auth_rate_buckets as b (bucket, window_started, hits)
  values (p_bucket, clock_timestamp(), 1)
  on conflict (bucket) do update
    set hits = case
          when b.window_started <= clock_timestamp() - make_interval(secs => p_window_seconds) then 1
          else b.hits + 1
        end,
        window_started = case
          when b.window_started <= clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp()
          else b.window_started
        end
  returning hits into n;
  return n <= p_limit;
end $$;

create function recall_issue_enrollment(
  p_user_id uuid,
  p_workspace_id uuid,
  p_token_hash text,
  p_ttl_seconds integer,
  p_label text,
  p_limit integer,
  p_window_seconds integer
) returns table (
  outcome text,
  enrollment_id uuid,
  user_id uuid,
  workspace_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid;
  v_workspace uuid;
  v_id uuid;
  v_expires timestamptz;
begin
  if not recall_rate_allow('issue:operator', p_limit, p_window_seconds) then
    perform recall_audit('enrollment.issue', 'rate_limited', null, p_user_id, null, null, 'issue:operator', null);
    return query select 'rate_limited'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    perform recall_audit('enrollment.issue', 'rejected', null, p_user_id, null, null, 'issue:operator', 'invalid');
    return query select 'rejected'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if p_label is not null and (char_length(p_label) < 1 or char_length(p_label) > 80) then
    perform recall_audit('enrollment.issue', 'rejected', null, p_user_id, null, null, 'issue:operator', 'label');
    return query select 'rejected'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  v_user := coalesce(p_user_id, gen_random_uuid());
  perform set_config('app.user_id', v_user::text, true);
  perform set_config('app.workspace_id', '', true);
  perform pg_advisory_xact_lock(hashtextextended('provision:' || v_user::text, 0));

  if p_workspace_id is null then
    select w.id into v_workspace from workspaces w where w.personal_for_user = v_user;
    if v_workspace is null then
      v_workspace := gen_random_uuid();
      insert into workspaces (id, name, created_by, personal_for_user)
      values (v_workspace, 'Personal', v_user, v_user);
      insert into workspace_members (workspace_id, user_id, role)
      values (v_workspace, v_user, 'owner');
    end if;
  else
    select m.workspace_id into v_workspace
    from workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = v_user;
    if v_workspace is null then
      perform recall_audit('enrollment.issue', 'not_member', p_workspace_id, v_user, null, null, 'issue:operator', null);
      return query select 'not_member'::text, null::uuid, v_user, p_workspace_id, null::timestamptz;
      return;
    end if;
  end if;

  v_id := gen_random_uuid();
  v_expires := clock_timestamp() + make_interval(secs => p_ttl_seconds);
  insert into device_enrollments (id, workspace_id, user_id, token_hash, label, expires_at)
  values (v_id, v_workspace, v_user, p_token_hash, p_label, v_expires);
  perform recall_audit('enrollment.issue', 'issued', v_workspace, v_user, null, v_id, 'issue:operator', null);
  return query select 'issued'::text, v_id, v_user, v_workspace, v_expires;
end $$;

create function recall_redeem_enrollment(
  p_token_hash text,
  p_session_hash text,
  p_session_ttl_seconds integer,
  p_device_id uuid,
  p_user_agent text,
  p_client_bucket text,
  p_client_limit integer,
  p_global_limit integer,
  p_window_seconds integer
) returns table (
  outcome text,
  enrollment_id uuid,
  session_id uuid,
  user_id uuid,
  workspace_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec device_enrollments%rowtype;
  v_session uuid;
  v_expires timestamptz;
  v_outcome text;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_session_hash !~ '^[a-f0-9]{64}$'
     or p_session_ttl_seconds < 3600 or p_session_ttl_seconds > 2592000 then
    perform recall_audit('enrollment.redeem', 'rejected', null, null, null, null, p_client_bucket, 'invalid');
    return query select 'rejected'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if not recall_rate_allow('redeem:' || left(coalesce(p_client_bucket, 'anonymous'), 64), p_client_limit, p_window_seconds)
     or not recall_rate_allow('redeem:global', p_global_limit, p_window_seconds) then
    perform recall_audit('enrollment.redeem', 'rate_limited', null, null, null, null, p_client_bucket, null);
    return query select 'rate_limited'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  select * into rec from device_enrollments where token_hash = p_token_hash for update;
  if not found then
    v_outcome := 'unknown';
    perform recall_audit('enrollment.redeem', v_outcome, null, null, null, null, p_client_bucket, null);
    return query select v_outcome, null::uuid, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if rec.revoked_at is not null then
    v_outcome := 'revoked';
  elsif rec.expires_at <= clock_timestamp() then
    v_outcome := 'expired';
  elsif rec.consumed_at is not null then
    v_outcome := 'replayed';
  else
    v_outcome := 'redeemed';
  end if;
  if v_outcome <> 'redeemed' then
    perform recall_audit(
      'enrollment.redeem', v_outcome, rec.workspace_id, rec.user_id, rec.consumed_session_id, rec.id, p_client_bucket, null
    );
    return query select v_outcome, rec.id, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  v_session := gen_random_uuid();
  v_expires := clock_timestamp() + make_interval(secs => p_session_ttl_seconds);
  insert into device_sessions (id, workspace_id, user_id, device_id, token_hash, expires_at, user_agent)
  values (
    v_session, rec.workspace_id, rec.user_id, p_device_id, p_session_hash, v_expires, left(p_user_agent, 200)
  );
  update device_enrollments
     set consumed_at = clock_timestamp(), consumed_session_id = v_session
   where id = rec.id;
  perform recall_audit(
    'enrollment.redeem', 'redeemed', rec.workspace_id, rec.user_id, v_session, rec.id, p_client_bucket, null
  );
  return query select 'redeemed'::text, rec.id, v_session, rec.user_id, rec.workspace_id, v_expires;
end $$;

create function recall_resolve_device_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;
  return query
  update device_sessions
     set last_seen_at = clock_timestamp()
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > clock_timestamp()
  returning id, device_sessions.user_id, device_sessions.workspace_id;
end $$;

create function recall_revoke_device_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec device_sessions%rowtype;
begin
  update device_sessions
     set revoked_at = clock_timestamp()
   where id = p_session_id and revoked_at is null
  returning * into rec;
  if not found then
    perform recall_audit('session.revoke', 'missing', null, null, p_session_id, null, 'operator', null);
    return false;
  end if;
  perform recall_audit('session.revoke', 'revoked', rec.workspace_id, rec.user_id, rec.id, null, 'operator', null);
  return true;
end $$;

create function recall_revoke_device_session_hash(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec device_sessions%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  update device_sessions
     set revoked_at = clock_timestamp()
   where token_hash = p_token_hash and revoked_at is null
  returning * into rec;
  if not found then
    perform recall_audit('session.revoke', 'missing', null, null, null, null, 'device', null);
    return false;
  end if;
  perform recall_audit('session.revoke', 'revoked', rec.workspace_id, rec.user_id, rec.id, null, 'device', null);
  return true;
end $$;

create function recall_revoke_workspace_device_sessions(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  update device_sessions
     set revoked_at = clock_timestamp()
   where workspace_id = p_workspace_id and revoked_at is null;
  get diagnostics n = row_count;
  update device_enrollments
     set revoked_at = clock_timestamp()
   where workspace_id = p_workspace_id and consumed_at is null and revoked_at is null;
  perform recall_audit('session.revoke', 'workspace', p_workspace_id, null, null, null, 'operator', n::text);
  return n;
end $$;

create function recall_revoke_enrollment(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec device_enrollments%rowtype;
begin
  update device_enrollments
     set revoked_at = clock_timestamp()
   where id = p_enrollment_id and consumed_at is null and revoked_at is null
  returning * into rec;
  if not found then
    perform recall_audit('enrollment.revoke', 'missing', null, null, null, p_enrollment_id, 'operator', null);
    return false;
  end if;
  perform recall_audit('enrollment.revoke', 'revoked', rec.workspace_id, rec.user_id, null, rec.id, 'operator', null);
  return true;
end $$;

create function recall_kill_device_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  update device_sessions set revoked_at = clock_timestamp() where revoked_at is null;
  get diagnostics n = row_count;
  update device_enrollments
     set revoked_at = clock_timestamp()
   where consumed_at is null and revoked_at is null;
  perform recall_audit('session.kill', 'revoked', null, null, null, null, 'operator', n::text);
  return n;
end $$;

create function recall_note_csrf(p_client_bucket text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform recall_audit('enrollment.redeem', 'csrf', null, null, null, null, p_client_bucket, null);
end $$;

revoke all on function recall_audit(text, text, uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function recall_rate_allow(text, integer, integer) from public;
revoke all on function recall_issue_enrollment(uuid, uuid, text, integer, text, integer, integer) from public;
revoke all on function recall_redeem_enrollment(text, text, integer, uuid, text, text, integer, integer, integer) from public;
revoke all on function recall_resolve_device_session(text) from public;
revoke all on function recall_revoke_device_session(uuid) from public;
revoke all on function recall_revoke_device_session_hash(text) from public;
revoke all on function recall_revoke_workspace_device_sessions(uuid) from public;
revoke all on function recall_revoke_enrollment(uuid) from public;
revoke all on function recall_kill_device_sessions() from public;
revoke all on function recall_note_csrf(text) from public;

grant execute on function recall_issue_enrollment(uuid, uuid, text, integer, text, integer, integer) to recall_app;
grant execute on function recall_redeem_enrollment(text, text, integer, uuid, text, text, integer, integer, integer) to recall_app;
grant execute on function recall_resolve_device_session(text) to recall_app;
grant execute on function recall_revoke_device_session(uuid) to recall_app;
grant execute on function recall_revoke_device_session_hash(text) to recall_app;
grant execute on function recall_revoke_workspace_device_sessions(uuid) to recall_app;
grant execute on function recall_revoke_enrollment(uuid) to recall_app;
grant execute on function recall_kill_device_sessions() to recall_app;
grant execute on function recall_note_csrf(text) to recall_app;
