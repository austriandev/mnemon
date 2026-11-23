-- Which access code a paid call was made under, by name, so each code can have its own
-- daily limit (ADR-0016). Null for calls made without one: the CLI, or an open gate.
alter table spend add column access_code text check (access_code <> '');
create index spend_day_access_code_idx on spend (day, access_code);
