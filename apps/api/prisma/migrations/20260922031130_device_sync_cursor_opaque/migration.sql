-- The sync cursor becomes an opaque, adapter-defined value (record index, sequence…).
-- Timestamp cursors cannot be translated, so they are cleared: the next sync re-reads the
-- device memory, which is safe because ingestion is idempotent (unique dedup_key).
ALTER TABLE "devices" ALTER COLUMN "last_sync_cursor" SET DATA TYPE TEXT USING NULL;
