-- Transcription is a paid call too, billed by the audio's length (ADR-0018). It counts
-- against the same daily and per-code limits as the model calls.
alter table spend drop constraint spend_provider_check;
alter table spend add constraint spend_provider_check
  check (provider in ('anthropic', 'voyage', 'assemblyai'));
