-- The day a meeting was held, so an answer can place "by Friday" in time.
-- Null when not known: transcripts carry offsets from the start, not dates.
alter table meetings add column held_on date;
