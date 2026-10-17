-- Additive cloud representation of the existing native Markdown library.
-- Native identifiers, immutable originals and human revision history survive migration.
create table library_documents (
  workspace_id uuid not null references workspaces(id),
  id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  state text not null check (state in ('active','deleted')),
  note text not null check (octet_length(note) <= 262144),
  source_name text not null,
  note_path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_key text not null,
  mime_type text not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,id)
);
create table library_revisions (
  workspace_id uuid not null,
  memory_id uuid not null,
  revision bigint not null,
  note text not null,
  state text not null,
  origin text not null,
  kind text not null,
  recorded_at timestamptz not null default now(),
  primary key (workspace_id,memory_id,revision),
  foreign key (workspace_id,memory_id) references library_documents(workspace_id,id)
);
create table library_operations (
  workspace_id uuid not null references workspaces(id),
  operation_id uuid not null,
  request_sha256 text not null,
  response jsonb not null,
  primary key (workspace_id,operation_id)
);
do $$ declare tab text; begin
  foreach tab in array array['library_documents','library_revisions','library_operations'] loop
    execute format('alter table %I enable row level security', tab);
    execute format('alter table %I force row level security', tab);
    execute format('create policy library_member on %I to recall_app using (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id)) with check (workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))', tab);
    execute format('grant select,insert on %I to recall_app', tab);
  end loop;
end $$;
grant update(note,revision,state,updated_at) on library_documents to recall_app;
create trigger library_documents_sync after insert or update on library_documents
  for each row execute function recall_publish_change('document','id');
