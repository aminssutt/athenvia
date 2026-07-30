-- Migration review:
-- 1. Preflight rows without a creator:
--    SELECT id FROM data_revisions
--    WHERE NOT created_by_worker AND created_by_user_id IS NULL;
-- 2. Provenance and revision values become immutable. Review workflows may
--    update only status, reviewed_at, confidence_score and has_conflict.
-- 3. Conflicting revisions cannot be approved until review clears the flag.

ALTER TABLE "data_revisions"
ADD COLUMN "source_snapshot_id" UUID,
ADD COLUMN "conflict_key" TEXT,
ADD COLUMN "has_conflict" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "data_revisions_creator_check"
CHECK (
  ("created_by_worker" AND "created_by_user_id" IS NULL)
  OR (NOT "created_by_worker" AND "created_by_user_id" IS NOT NULL)
);

ALTER TABLE "data_revisions"
ADD CONSTRAINT "data_revisions_source_snapshot_id_fkey"
FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_revisions"
DROP CONSTRAINT "data_revisions_source_id_fkey",
ADD CONSTRAINT "data_revisions_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_revisions"
DROP CONSTRAINT "data_revisions_created_by_user_id_fkey",
ADD CONSTRAINT "data_revisions_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "data_revisions_entity_field_status_idx"
ON "data_revisions"("entity_type", "entity_id", "field_name", "change_status");

CREATE INDEX "data_revisions_conflict_key_status_idx"
ON "data_revisions"("conflict_key", "change_status");

CREATE FUNCTION "protect_data_revision_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data revision history is append-only'
      USING ERRCODE = '55000';
  END IF;

  IF (
    OLD."entity_type" IS DISTINCT FROM NEW."entity_type"
    OR OLD."entity_id" IS DISTINCT FROM NEW."entity_id"
    OR OLD."field_name" IS DISTINCT FROM NEW."field_name"
    OR OLD."old_value" IS DISTINCT FROM NEW."old_value"
    OR OLD."new_value" IS DISTINCT FROM NEW."new_value"
    OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
    OR OLD."source_snapshot_id" IS DISTINCT FROM NEW."source_snapshot_id"
    OR OLD."created_by_user_id" IS DISTINCT FROM NEW."created_by_user_id"
    OR OLD."created_by_worker" IS DISTINCT FROM NEW."created_by_worker"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
    OR OLD."conflict_key" IS DISTINCT FROM NEW."conflict_key"
  ) THEN
    RAISE EXCEPTION 'data revision evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."change_status" = 'APPROVED' AND NEW."has_conflict" THEN
    RAISE EXCEPTION 'conflicting data revisions require review before approval'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "data_revision_history_is_protected"
BEFORE UPDATE OR DELETE ON "data_revisions"
FOR EACH ROW
EXECUTE FUNCTION "protect_data_revision_history"();
