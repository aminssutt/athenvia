-- Universities publish deadlines and almost never an exact opening instant.
-- Requiring both discarded the exact, officially sourced deadline students act
-- on, so a confirmed window now needs at least one exact date; a null field
-- reads as "not published yet" and reminders schedule on the dates that exist.

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
       AND NEW."opens_at" IS NULL AND NEW."closes_at" IS NULL THEN
        RAISE EXCEPTION 'confirmed application windows require at least one exact date'
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
