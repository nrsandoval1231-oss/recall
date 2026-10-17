-- Source-specific authorization and a durable delivery/result receipt. No historical backfill.
create table library_processing (
 workspace_id uuid not null,
 memory_id uuid not null,
 expected_revision bigint not null,
 source_sha256 text not null,
 state text not null check(state in ('pending','consent-required','configuration-required','processing','complete','failed','uncertain')),
 message text not null,
 attempts integer not null default 0,
 dispatched_at timestamptz,
 lease_until timestamptz,
 lease_token uuid,
 result jsonb,
 reservation_id uuid,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,memory_id),
 foreign key(workspace_id,memory_id) references library_documents(workspace_id,id) on delete cascade
);
alter table library_processing enable row level security;
alter table library_processing force row level security;
create policy library_processing_member on library_processing to recall_app
 using(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id))
 with check(workspace_id=recall_current_workspace_id() and recall_is_member(workspace_id));
create policy library_processing_worker on library_processing to recall_worker using(true) with check(true);
grant select,insert,update on library_processing to recall_app,recall_worker;
-- Workers can discover work, but original content is scoped to the claimed workspace.
create policy library_document_worker on library_documents to recall_worker
 using(workspace_id=recall_current_workspace_id()) with check(workspace_id=recall_current_workspace_id());
create policy library_revision_worker on library_revisions to recall_worker
 using(workspace_id=recall_current_workspace_id()) with check(workspace_id=recall_current_workspace_id());
grant select,update(note,revision,updated_at) on library_documents to recall_worker;
grant select,insert on library_revisions to recall_worker;
