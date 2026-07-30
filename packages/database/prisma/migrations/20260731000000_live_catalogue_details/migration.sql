-- Persist source-backed programme summaries separately so text and provenance
-- are always updated as one canonical fact.
CREATE TABLE "program_summaries" (
    "program_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "last_verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_summaries_pkey" PRIMARY KEY ("program_id"),
    CONSTRAINT "program_summaries_text_length_check"
        CHECK (char_length(btrim("text")) BETWEEN 80 AND 800)
);

ALTER TABLE "application_windows"
ADD COLUMN "source_id" UUID;

CREATE INDEX "program_summaries_source_id_idx"
ON "program_summaries"("source_id");

CREATE INDEX "application_windows_source_id_idx"
ON "application_windows"("source_id");

ALTER TABLE "program_summaries"
ADD CONSTRAINT "program_summaries_program_id_fkey"
FOREIGN KEY ("program_id") REFERENCES "programs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_summaries"
ADD CONSTRAINT "program_summaries_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id")
ON DELETE NO ACTION ON UPDATE CASCADE
DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "application_windows"
ADD CONSTRAINT "application_windows_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id")
ON DELETE NO ACTION ON UPDATE CASCADE
DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION enforce_program_summary_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    evidence "sources"%ROWTYPE;
BEGIN
    SELECT *
    INTO evidence
    FROM "sources"
    WHERE "id" = NEW."source_id";

    IF NOT FOUND
       OR evidence."is_official" IS NOT TRUE
       OR evidence."program_id" IS DISTINCT FROM NEW."program_id" THEN
        RAISE EXCEPTION 'program summary evidence must be an official source owned by the same program'
            USING ERRCODE = '23514';
    END IF;

    IF evidence."last_checked_at" IS NULL
       OR NEW."last_verified_at" > evidence."last_checked_at" THEN
        RAISE EXCEPTION 'program summary verification cannot be later than its source check'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW."last_verified_at" < OLD."last_verified_at" THEN
            RAISE EXCEPTION 'program summary verification cannot move backwards'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."last_verified_at" = OLD."last_verified_at"
           AND (
               NEW."text" IS DISTINCT FROM OLD."text"
               OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
           ) THEN
            RAISE EXCEPTION 'program summary evidence conflicts at the same verification instant'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "program_summaries_evidence_guard"
BEFORE INSERT OR UPDATE ON "program_summaries"
FOR EACH ROW
EXECUTE FUNCTION enforce_program_summary_evidence();

CREATE OR REPLACE FUNCTION enforce_application_window_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    evidence "sources"%ROWTYPE;
    intake_program_id UUID;
BEGIN
    IF (
        NEW."public_status" = 'CONFIRMED'
        OR NEW."opens_at" IS NOT NULL
        OR NEW."closes_at" IS NOT NULL
    ) AND (
        NEW."source_id" IS NULL
        OR NEW."last_verified_at" IS NULL
    ) THEN
        RAISE EXCEPTION 'confirmed or exact application dates require verified official evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."public_status" = 'CONFIRMED'
       AND (NEW."opens_at" IS NULL OR NEW."closes_at" IS NULL) THEN
        RAISE EXCEPTION 'confirmed application windows require both exact dates'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."source_id" IS NULL THEN
        IF TG_OP = 'UPDATE'
           AND NEW."last_verified_at" IS NOT DISTINCT FROM OLD."last_verified_at"
           AND (
               NEW."round_name" IS DISTINCT FROM OLD."round_name"
               OR NEW."opens_at" IS DISTINCT FROM OLD."opens_at"
               OR NEW."closes_at" IS DISTINCT FROM OLD."closes_at"
               OR NEW."public_status" IS DISTINCT FROM OLD."public_status"
               OR NEW."verification" IS DISTINCT FROM OLD."verification"
           ) THEN
            RAISE EXCEPTION 'application window evidence conflicts at the same verification instant'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."last_verified_at" IS NULL THEN
        RAISE EXCEPTION 'sourced application windows require a verification instant'
            USING ERRCODE = '23514';
    END IF;

    SELECT "program_id"
    INTO intake_program_id
    FROM "intakes"
    WHERE "id" = NEW."intake_id";

    SELECT *
    INTO evidence
    FROM "sources"
    WHERE "id" = NEW."source_id";

    IF intake_program_id IS NULL
       OR NOT FOUND
       OR evidence."is_official" IS NOT TRUE
       OR evidence."program_id" IS DISTINCT FROM intake_program_id THEN
        RAISE EXCEPTION 'application window evidence must be an official source owned by the intake program'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."last_verified_at" IS NOT NULL
       AND (
           evidence."last_checked_at" IS NULL
           OR NEW."last_verified_at" > evidence."last_checked_at"
       ) THEN
        RAISE EXCEPTION 'application window verification cannot be later than its source check'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD."last_verified_at" IS NOT NULL
       AND NEW."last_verified_at" IS NOT NULL THEN
        IF NEW."last_verified_at" < OLD."last_verified_at" THEN
            RAISE EXCEPTION 'application window verification cannot move backwards'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."last_verified_at" = OLD."last_verified_at"
           AND NOT (
               OLD."source_id" IS NULL
               AND NEW."source_id" IS NOT NULL
               AND NEW."round_name" IS NOT DISTINCT FROM OLD."round_name"
               AND NEW."opens_at" IS NOT DISTINCT FROM OLD."opens_at"
               AND NEW."closes_at" IS NOT DISTINCT FROM OLD."closes_at"
               AND NEW."public_status" IS NOT DISTINCT FROM OLD."public_status"
               AND NEW."verification" IS NOT DISTINCT FROM OLD."verification"
           )
           AND (
               NEW."source_id" IS DISTINCT FROM OLD."source_id"
               OR NEW."round_name" IS DISTINCT FROM OLD."round_name"
               OR NEW."opens_at" IS DISTINCT FROM OLD."opens_at"
               OR NEW."closes_at" IS DISTINCT FROM OLD."closes_at"
               OR NEW."public_status" IS DISTINCT FROM OLD."public_status"
               OR NEW."verification" IS DISTINCT FROM OLD."verification"
           ) THEN
            RAISE EXCEPTION 'application window evidence conflicts at the same verification instant'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "application_windows_evidence_guard"
BEFORE INSERT OR UPDATE
ON "application_windows"
FOR EACH ROW
EXECUTE FUNCTION enforce_application_window_evidence();

CREATE OR REPLACE FUNCTION protect_referenced_source_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "program_summaries" AS summary
        WHERE summary."source_id" = OLD."id"
          AND (
              NEW."is_official" IS NOT TRUE
              OR NEW."program_id" IS DISTINCT FROM summary."program_id"
              OR NEW."last_checked_at" IS NULL
              OR NEW."last_checked_at" < summary."last_verified_at"
          )
    ) THEN
        RAISE EXCEPTION 'source update would invalidate a programme summary'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "application_windows" AS application_window
        JOIN "intakes" AS intake ON intake."id" = application_window."intake_id"
        WHERE application_window."source_id" = OLD."id"
          AND (
              NEW."is_official" IS NOT TRUE
              OR NEW."program_id" IS DISTINCT FROM intake."program_id"
              OR (
                  application_window."last_verified_at" IS NOT NULL
                  AND (
                      NEW."last_checked_at" IS NULL
                      OR NEW."last_checked_at" < application_window."last_verified_at"
                  )
              )
          )
    ) THEN
        RAISE EXCEPTION 'source update would invalidate an application window'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "sources_referenced_evidence_guard"
BEFORE UPDATE OF "program_id", "is_official", "last_checked_at"
ON "sources"
FOR EACH ROW
EXECUTE FUNCTION protect_referenced_source_evidence();

CREATE OR REPLACE FUNCTION protect_window_intake_program()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."program_id" IS DISTINCT FROM OLD."program_id"
       AND EXISTS (
           SELECT 1
           FROM "application_windows" AS application_window
           JOIN "sources" AS source ON source."id" = application_window."source_id"
           WHERE application_window."intake_id" = OLD."id"
             AND source."program_id" IS DISTINCT FROM NEW."program_id"
       ) THEN
        RAISE EXCEPTION 'intake update would detach application-window evidence from its program'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "intakes_window_evidence_guard"
BEFORE UPDATE OF "program_id" ON "intakes"
FOR EACH ROW
EXECUTE FUNCTION protect_window_intake_program();
