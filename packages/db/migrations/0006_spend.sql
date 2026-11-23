-- Every paid call the web app makes, so a day's spend can be capped and read back.
-- `day` is the calendar day the call counts against, as the app decides it.
create table spend (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  day date not null,
  provider text not null check (provider in ('anthropic', 'voyage')),
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(12, 7) not null check (cost_usd >= 0)
);

create index spend_day on spend (day);
