// Public interface of @mnemon/db: Postgres storage for Mnemon.

export { createChunkSearch } from "./chunk-search.ts";
export { databaseUrl, LOCAL_DATABASE_URL } from "./config.ts";
export {
  createMeetingStore,
  type MeetingStore,
  type MeetingSummary,
  type NewMeeting,
  type StoredMeeting,
} from "./meeting-store.ts";
export { createSpendLedger } from "./spend-ledger.ts";
// migrate is imported from "@mnemon/db/migrate": it reads SQL files from disk, so the web
// server, which does not own the schema, never bundles it.
export { ALL_MEETINGS, type Visibility } from "./visibility.ts";
