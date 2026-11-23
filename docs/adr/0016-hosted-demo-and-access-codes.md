---
status: accepted
---

# A hosted demo, with an access code and a daily limit per reviewer

Supersedes the "local only" part of ADR-0015; the containers stay the way to run it
yourself.

## Context

Reviewers could run Mnemon only by installing Docker and bringing two API keys of
their own. A hosted copy lets them sign in and use it straight away, on our keys.
That makes the spending limit matter more: one shared code with one daily limit
(ADR-0014) means a single reviewer could use up the whole day, and no one can tell
whose questions cost what.

## Decision

- **Hosting:** Vercel (Hobby) runs the Next.js app as functions in `iad1`, next to
  the Anthropic and Voyage APIs. Neon Postgres, which has pgvector, holds the data in
  the same region, provisioned through Vercel's Marketplace and connected to
  Production only, so preview builds never reach it. Functions may run 300 s, above
  the slowest call (extracting a 165-turn meeting, ADR-0013).
- **A code per reviewer.** `MNEMON_ACCESS_CODES` lists `name:code[:dollars]` entries.
  Each code is held to its own daily limit (`MNEMON_CODE_DAILY_LIMIT_USD`, $2) and to
  the day's limit all codes share (`MNEMON_DAILY_LIMIT_USD`, $10 on the hosted copy).
  A single `MNEMON_ACCESS_CODE` still works, named `shared`, with no limit of its own.
- **Sessions know their code.** The cookie is `name.expiry.signature`, signed with a
  key derived from that code, so changing or removing one code signs out only its
  sessions. A malformed list fails closed, and the log says which entry is wrong
  without ever echoing a code.
- **Spend is charged to its code.** Every ledger row carries the code's name
  (migration 0008). Each request waits for its own ledger writes before it returns:
  a serverless function can be frozen once its response is sent, and a write still in
  flight would be lost, so the limit would count low.
- **Secrets live in the platform.** API keys and codes are Vercel environment
  variables (codes marked sensitive). `.vercelignore` keeps `.env` and local notes out
  of any CLI upload.
- **Protection:** the production domain is public and gated by the access code; every
  other deployment URL and every preview stays behind Vercel's login.

Checked by a live run of the production build with two codes at $0.12 each: a wrong
code was refused; reviewer-a's first question was answered ($0.028) and the second
refused by the code's own limit; reviewer-b could still ask ($0.021); each ledger row
named its code.

## Consequences

- Reviewers shared one workspace, seeing any meeting one of them added. ADR-0017
  replaces this: a meeting added under a code is private to it.
- The hosted copy costs only API calls, capped at $10 a day; a monthly limit on the
  Anthropic workspace is the backstop if our own limits failed.
- Neon's free tier pauses when idle, so the first request after a quiet spell takes a
  few seconds longer.
- "Today" is the server's calendar day, which on Vercel is UTC (ADR-0012, ADR-0014).

## Considered options

- **Cloud Run with the Docker image** (ADR-0015). Runs exactly the image CI builds,
  and the free tier is generous, but it needs a billing account and a managed Postgres
  set up by hand. Vercel needs neither.
- **Per-reviewer workspaces.** Each code would see only its own meetings. Right for
  real customers, but it touches every query; for a demo over synthetic data, one
  shared workspace is enough.
- **Users and passwords.** No accounts to manage for a handful of reviewers; a code
  each, revocable one at a time, gives the same control.
