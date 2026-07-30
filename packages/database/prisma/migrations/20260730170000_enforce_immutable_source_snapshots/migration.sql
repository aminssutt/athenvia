-- Migration review:
-- 1. The unique indexes intentionally fail if historical duplicate evidence or
--    storage-key collisions exist. Run the preflight queries documented in
--    packages/database/SOURCE_SNAPSHOTS.md before production deployment.
-- 2. Existing snapshots become append-only. Source deletion and source link
--    reassignment are rejected after a snapshot exists.

CREATE UNIQUE INDEX "source_snapshots_source_id_content_hash_key"
ON "source_snapshots"("source_id", "content_hash");

CREATE UNIQUE INDEX "source_snapshots_storage_key_key"
ON "source_snapshots"("storage_key");

ALTER TABLE "source_snapshots"
DROP CONSTRAINT "source_snapshots_source_id_fkey";

ALTER TABLE "source_snapshots"
ADD CONSTRAINT "source_snapshots_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_source_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'source snapshots are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "source_snapshots_are_immutable"
BEFORE UPDATE OR DELETE ON "source_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "prevent_source_snapshot_mutation"();

CREATE FUNCTION "preserve_snapshotted_source_links"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    OLD."university_id" IS DISTINCT FROM NEW."university_id"
    OR OLD."program_id" IS DISTINCT FROM NEW."program_id"
  ) AND EXISTS (
    SELECT 1
    FROM "source_snapshots"
    WHERE "source_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'snapshotted source ownership links are immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "snapshotted_source_links_are_immutable"
BEFORE UPDATE OF "university_id", "program_id" ON "sources"
FOR EACH ROW
EXECUTE FUNCTION "preserve_snapshotted_source_links"();
