-- A meeting added under an access code belongs to that code: only it sees the meeting
-- and only its questions search it (ADR-0017). Common meetings, loaded by an operator,
-- have no owner and are seen by everyone.
alter table meetings add column owner text check (owner <> '');

-- A transcript is stored once per owner rather than once in all: two codes may each
-- hold a private copy, and neither can learn from a conflict that the other has it.
alter table meetings drop constraint meetings_source_sha256_key;
create unique index meetings_owner_source_key on meetings (coalesce(owner, ''), source_sha256);
create index meetings_owner_idx on meetings (owner);
