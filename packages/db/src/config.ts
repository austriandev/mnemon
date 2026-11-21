/** Matches docker-compose.yml, so `pnpm db:up` is all local development needs. */
export const LOCAL_DATABASE_URL = "postgres://mnemon:mnemon@localhost:54320/mnemon";

export function databaseUrl(): string {
  return process.env.MNEMON_DATABASE_URL ?? LOCAL_DATABASE_URL;
}
