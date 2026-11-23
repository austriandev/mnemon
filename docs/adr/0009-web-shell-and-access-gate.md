---
status: accepted
---

# The web app: a thin Next.js shell, behind a shared access code

`apps/web` is the browser front end. It adds no behaviour of its own: asking,
retrieval, citation checks and records all come from `@mnemon/core` and the same
adapters the CLI uses, wired once in `src/server/mnemon.ts`.

## Shape

- **Next.js 16 App Router, server-first.** Pages are server components that read the
  store directly. Asking is a server action (`askQuestion`); the browser never sees an
  API key, a prompt or a withheld answer's text. `presentAnswer` turns the core's
  `AskResult` into plain view data: each distinct citation numbered once, linked to
  `/meetings/<id>#turn-<n>`.
- **Every citation is one click from its turn.** The meeting page renders the whole
  transcript with an anchor per turn; a cited turn is highlighted when linked to.
- **The web server doesn't own the schema.** Migrations run as their own step
  (`pnpm db:migrate`, later a deploy job) before the server starts. `migrate` moved to
  the `@mnemon/db/migrate` subpath, which reads SQL files from disk and so can't be
  bundled. The CLI and eval still migrate on connect.
- **Types are checked by `pnpm typecheck`** (TypeScript 7) in CI; `next build` skips
  its own check. CI now also runs `pnpm web:build`, so a bundling error fails the PR.

## Access gate

A deployed demo calls paid APIs on every question, so it must not be open to anyone
with the URL. The gate is one shared code, not user accounts:

- `MNEMON_ACCESS_CODE` is compared in constant time (SHA-256 digests,
  `timingSafeEqual`). A wrong code waits 600 ms before answering.
- A correct code sets an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production)
  holding `<expiry>.<HMAC-SHA256>`, valid for 12 hours. The HMAC key is derived from
  the code, so changing the code signs everyone out.
- **Fails closed:** with no code in production, no one gets in. In development the
  app is open and says so in the top bar.
- Checked twice: `proxy.ts` redirects early, and every page and server action calls
  `requireSession()`, because a server action can be called without the proxy's page.
- Standard headers on every response: `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: same-origin`, HSTS, and a restrictive `Permissions-Policy`.

Verified against the production build: no cookie and a forged cookie both redirect to
sign-in; a wrong code sets no cookie and shows the error; the right code redirects with
a session cookie; a question asked through the page's form returns a cited answer.

## Design

White ground, Manrope at weight 400 for text and 500 for headings, a deep forest green
for weight (primary buttons, the sign-in panel's sky) and mint for light (the aurora,
focus, citations). The chrome stays grey: counts and meta are quiet text, not badges,
and the logo is the name alone. Green is kept for the citation, the numbered marker
and the timestamp chip that link an answer to the transcript, so the eye goes to the
evidence. The sign-in screen is a split layout: a calm CSS aurora panel with the
two-tone headline on the left, the form on white on the right. The aurora is still
under `prefers-reduced-motion`.

## Considered options

- **Real accounts** (an identity provider, per-user sessions and audit). The right
  answer for a regulated customer, where who asked what is itself a record. Out of
  scope for a demo; the gate keeps the API budget safe until then.
- **HTTP basic auth at a reverse proxy.** Works, but it's browser chrome, not the
  product, and it can't express "closed until configured".
- **A client-side SPA calling route handlers.** More moving parts and an API surface
  to protect; server actions keep the call next to the data.

## Consequences

- Anyone with the code can use the app and spend the API budget; there is no per-user
  rate limit yet. Rotate the code to revoke access.
- No Content-Security-Policy yet: Next.js's inline scripts need nonces, which is work
  for the deployment slice.
