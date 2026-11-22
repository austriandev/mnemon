-- A transcript is stored once. Ingesting the same bytes again returns the meeting
-- already stored, so retrieval never cites two copies of one conversation.
--
-- Pre-release cleanup: development databases may hold byte-identical copies from
-- before this rule. Keep the earliest of each and drop the rest (turns and chunks
-- cascade). Every row removed is a duplicate of a row kept.
delete from meetings m
using meetings earlier
where earlier.source_sha256 = m.source_sha256
  and (earlier.created_at, earlier.id) < (m.created_at, m.id);

alter table meetings add constraint meetings_source_sha256_key unique (source_sha256);
