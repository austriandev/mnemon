-- Meetings, their turns and chunks. Embedding and full-text columns arrive with
-- the retrieval slice, once the embedding model (and so its dimension) is chosen.

create extension if not exists vector;

create table meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (title <> ''),
  -- The transcript exactly as ingested, so every citation can be checked against it.
  source_text text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table turns (
  meeting_id uuid not null references meetings (id) on delete cascade,
  turn_index integer not null check (turn_index >= 0),
  speaker text not null check (speaker <> ''),
  start_seconds integer not null check (start_seconds >= 0),
  text text not null check (text <> ''),
  source_line_start integer not null check (source_line_start >= 1),
  source_line_end integer not null,
  primary key (meeting_id, turn_index),
  check (source_line_end >= source_line_start)
);

create table chunks (
  meeting_id uuid not null references meetings (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  first_turn integer not null,
  last_turn integer not null,
  start_seconds integer not null,
  end_seconds integer not null,
  speakers text[] not null check (cardinality(speakers) > 0),
  text text not null,
  token_count integer not null check (token_count >= 0),
  oversize boolean not null,
  primary key (meeting_id, chunk_index),
  -- A chunk can only cite turns that exist in the same meeting.
  foreign key (meeting_id, first_turn) references turns (meeting_id, turn_index),
  foreign key (meeting_id, last_turn) references turns (meeting_id, turn_index),
  check (last_turn >= first_turn),
  check (end_seconds >= start_seconds)
);
