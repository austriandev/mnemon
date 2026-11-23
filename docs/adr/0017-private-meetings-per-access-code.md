---
status: accepted
---

# Meetings added under an access code are private to it

Replaces the "one shared workspace" consequence of ADR-0016.

## Context

On the hosted demo every reviewer has an access code (ADR-0016), but all of them saw
the same meetings, and questions searched every meeting, including the ones other
reviewers added. A reviewer's test upload showed up for everyone, and an answer could
cite a transcript its reader never added. For a client in a regulated setting, keeping
each team's transcripts apart is the first thing they would ask about.

## Decision

- **A meeting has an owner**: the name of the access code it was added under, or none
  for a common meeting (migration 0009). The seeded demo meetings are common: an
  operator loads them with the CLI, which owns nothing.
- **A code sees the common meetings and its own.** Everywhere: the meeting list, a
  meeting's page, keyword and vector search, its records and transcript excerpts.
  Another code's meeting reads as missing, the same as one that doesn't exist, so its
  id, title or existence never leaks.
- **Enforced where the data is read.** The store and the search are built with a
  `Visibility` and add the condition to every query. The web app has no unscoped store:
  it gets meetings only through `forSession(session)`, so a page can't forget the
  filter. The core's interfaces don't change.
- **A transcript is stored once per owner**, not once in all. Two codes can each hold a
  private copy, and neither learns from a conflict that the other has it. A transcript
  that is already common is found by everyone, so no one stores a second copy of it.
- Without an access code (development, an open gate) the owner is none: meetings are
  common, as before.

Checked by tests on the store and search at the database (`visibility.test.ts`), and by
a live run of the production build with two codes (see the PR).

## Consequences

- Reviewers no longer see each other's uploads; the add page says a meeting is private
  to the code.
- The CLI and the eval see every meeting, as operator tools.
- Removing a code doesn't delete its meetings; they stay unseen until an operator
  deletes them (README).

## Considered options

- **Row-level security in Postgres.** The database itself would enforce it, even
  against a query that forgot the filter. Stronger, but it needs a role or a session
  setting per request, which a pooled serverless connection makes fiddly. The single
  place that builds every query is the next best thing; RLS is what a multi-tenant
  production version would add.
- **A schema or database per code.** Strongest separation, but migrations and seeding
  multiply with every code, for a demo with four.
