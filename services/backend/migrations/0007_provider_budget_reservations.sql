-- RCL-007: provider calls share the existing durable reservation ledger with embeddings.
-- Do not rename the established table: its RLS, aggregate-only owner access, erase handling and
-- deployment-wide spend function are already the canonical budget boundary.
alter table embedding_reservations drop constraint if exists embedding_reservations_purpose_check;
alter table embedding_reservations add constraint embedding_reservations_purpose_check
  check (purpose in ('query','document','interpret','repair','answer'));
