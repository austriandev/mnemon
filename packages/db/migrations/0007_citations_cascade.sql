-- A record's citation points at a turn, and deleting a meeting deletes its turns, so
-- the citation must go with them. Without the cascade, a meeting with records could
-- not be deleted at all.
alter table record_citations
  drop constraint record_citations_meeting_id_turn_index_fkey,
  add constraint record_citations_meeting_id_turn_index_fkey
    foreign key (meeting_id, turn_index) references turns (meeting_id, turn_index)
    on delete cascade;
