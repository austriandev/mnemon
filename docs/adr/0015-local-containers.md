---
status: accepted
---

# The app runs in containers locally, started by one script

## Context

Only Postgres ran in Docker. Running the app needed Node 24, pnpm and five commands in
order, and a reviewer's machine may already use port 3000 or 54320. Mnemon is run
locally by reviewers and in the demo; there is no hosted deployment.

## Decision

- **Two images from one Dockerfile.** `web` is the Next.js standalone server: traced
  files only, no compiler or source, running as the `node` user with a health check.
  `tools` is the workspace with its dependencies, for migrations and seeding; the CLI
  runs its TypeScript on Node as it does outside the container.
- **Compose runs them in order** under the `app` profile: `db` healthy, then `migrate`
  completes, then `web`. Without the profile, `pnpm db:up` still starts only Postgres
  for development, against the same volume.
- **Secrets stay out of the images.** `.dockerignore` excludes `.env`; containers read
  it at run time. The database address is set to the compose network's, whatever
  `.env` says for running on the host.
- **`scripts/app.sh up`** checks Docker and the keys (by name, never printing values),
  picks free ports (the next one if 3000 or 54320 is taken, and again if a port is
  taken while starting), builds, migrates, optionally seeds after showing the cost,
  waits for the health check, and prints the address and access code.
- **The container runs in production mode**, so it needs an access code. When neither
  the shell nor `.env` sets one, the script generates one, keeps it in `.mnemon/`
  (gitignored), and passes it through the shell, which Compose prefers over `.env`.
- CI builds both images on every push.

Checked by runs on the dev machine: with the dev server on 3000 the app moved to 3001;
with 3001 held by another program and the port check disabled, the start failed on
3001 and moved to 3002; sign-in worked in Chromium and WebKit; a question answered
from the container ($0.028) and its spend was recorded.

## Consequences

- One command from a clean checkout, with Docker the only tool to install.
- The first build takes a few minutes; later builds reuse cached dependencies.
- The `tools` image carries the whole workspace (about the size of `node_modules`). It
  is for one-shot commands, not serving.
- Sessions use `Secure` cookies in production. Browsers accept them on
  `http://localhost`; a deployment elsewhere needs HTTPS in front.

## Considered options

- **Pnpm only, no app container.** Fewer moving parts, but every reviewer needs Node
  and pnpm at the right versions, and nothing shows the app runs as a deployable unit.
- **Migrate on web start.** One container fewer, but every web replica would race to
  migrate, and the web image would need the migration files and a database owner's
  rights. A separate one-shot step is the shape a hosted deployment would use.
- **A Makefile.** Not installed everywhere by default; a bash script runs on macOS and
  Linux as is.
