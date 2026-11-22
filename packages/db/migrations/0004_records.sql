-- Records extracted from a meeting (decisions, action items, topics) and their
-- citations. A citation points at a turn of the same meeting, enforced by a foreign
-- key, and carries the words quoted from it.

-- The model that produced the meeting's records. Null means not extracted yet, which
-- is how meetings stored before this migration read; records are added once.
alter table meetings add column records_model text check (records_model <> '');

create table records (
  meeting_id uuid not null references meetings (id) on delete cascade,
  record_index integer not null check (record_index >= 0),
  kind text not null check (kind in ('decision', 'action_item', 'topic')),
  summary text not null check (summary <> ''),
  owner text check (owner <> ''),
  due text check (due <> ''),
  primary key (meeting_id, record_index),
  check (kind <> 'action_item' or owner is not null)
);

create table record_citations (
  meeting_id uuid not null,
  record_index integer not null,
  citation_index integer not null check (citation_index >= 0),
  turn_index integer not null,
  quote text not null check (quote <> ''),
  primary key (meeting_id, record_index, citation_index),
  foreign key (meeting_id, record_index)
    references records (meeting_id, record_index) on delete cascade,
  foreign key (meeting_id, turn_index) references turns (meeting_id, turn_index)
);
