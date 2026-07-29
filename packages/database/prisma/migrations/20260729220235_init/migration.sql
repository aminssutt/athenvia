-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DegreeType" AS ENUM ('MASTER', 'MBA', 'PHD', 'OTHER');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'COMPLETED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PublicDateStatus" AS ENUM ('CONFIRMED', 'EXPECTED', 'NOT_PUBLISHED');

-- CreateEnum
CREATE TYPE "InternalVerificationStatus" AS ENUM ('OFFICIAL', 'VERIFIED', 'EXPECTED', 'COMMUNITY_SUBMITTED', 'CONFLICTING', 'OUTDATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TrackingStatus" AS ENUM ('WATCHING', 'OPEN_NOW', 'APPLIED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION_OPENING', 'APPLICATION_DEADLINE', 'DATE_CHANGED', 'SUBMISSION_APPROVED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "city" TEXT,
    "official_domain" TEXT,
    "official_website" TEXT,
    "logo_asset_id" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_aliases" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,

    CONSTRAINT "university_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "degree_type" "DegreeType" NOT NULL,
    "duration_months" INTEGER,
    "campus" TEXT,
    "language" TEXT,
    "official_url" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_domains" (
    "program_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,

    CONSTRAINT "program_domains_pkey" PRIMARY KEY ("program_id","domain_id")
);

-- CreateTable
CREATE TABLE "intakes" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "start_date" DATE,
    "status" "IntakeStatus" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_windows" (
    "id" UUID NOT NULL,
    "intake_id" UUID NOT NULL,
    "round_name" TEXT,
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "public_status" "PublicDateStatus" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "confidence_score" DECIMAL(5,4),
    "verification" "InternalVerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "university_id" UUID,
    "program_id" UUID,
    "url" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMP(3),
    "http_status" INTEGER,
    "content_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_snapshots" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_revisions" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "source_id" UUID,
    "change_status" "ChangeStatus" NOT NULL DEFAULT 'PENDING',
    "confidence_score" DECIMAL(5,4),
    "created_by_user_id" UUID,
    "created_by_worker" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "data_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_watchlists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "intake_id" UUID NOT NULL,
    "tracking_status" "TrackingStatus" NOT NULL DEFAULT 'WATCHING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "private_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "before_open_days" INTEGER[] DEFAULT ARRAY[30, 7]::INTEGER[],
    "before_deadline_days" INTEGER[] DEFAULT ARRAY[30, 14, 7, 2]::INTEGER[],
    "notify_on_open" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_date_change" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dedupe_key" TEXT NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_submissions" (
    "id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "official_website" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "university_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_submissions" (
    "id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "degree_type" "DegreeType" NOT NULL,
    "domain" TEXT NOT NULL,
    "official_url" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "program_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "universities_country_code_idx" ON "universities"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "universities_normalized_name_country_code_key" ON "universities"("normalized_name", "country_code");

-- CreateIndex
CREATE INDEX "university_aliases_normalized_alias_idx" ON "university_aliases"("normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "university_aliases_university_id_normalized_alias_key" ON "university_aliases"("university_id", "normalized_alias");

-- CreateIndex
CREATE INDEX "programs_normalized_name_idx" ON "programs"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "programs_university_id_normalized_name_degree_type_key" ON "programs"("university_id", "normalized_name", "degree_type");

-- CreateIndex
CREATE UNIQUE INDEX "domains_slug_key" ON "domains"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "intakes_program_id_year_month_key" ON "intakes"("program_id", "year", "month");

-- CreateIndex
CREATE INDEX "application_windows_opens_at_idx" ON "application_windows"("opens_at");

-- CreateIndex
CREATE INDEX "application_windows_closes_at_idx" ON "application_windows"("closes_at");

-- CreateIndex
CREATE INDEX "sources_university_id_idx" ON "sources"("university_id");

-- CreateIndex
CREATE INDEX "sources_program_id_idx" ON "sources"("program_id");

-- CreateIndex
CREATE INDEX "source_snapshots_source_id_captured_at_idx" ON "source_snapshots"("source_id", "captured_at");

-- CreateIndex
CREATE INDEX "data_revisions_entity_type_entity_id_idx" ON "data_revisions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "user_watchlists_user_id_tracking_status_idx" ON "user_watchlists"("user_id", "tracking_status");

-- CreateIndex
CREATE UNIQUE INDEX "user_watchlists_user_id_program_id_intake_id_key" ON "user_watchlists"("user_id", "program_id", "intake_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_watchlist_id_key" ON "notification_preferences"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key_key" ON "notification_deliveries"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_scheduled_for_idx" ON "notification_deliveries"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "university_submissions_status_created_at_idx" ON "university_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "program_submissions_status_created_at_idx" ON "program_submissions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "universities" ADD CONSTRAINT "universities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_aliases" ADD CONSTRAINT "university_aliases_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_domains" ADD CONSTRAINT "program_domains_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_domains" ADD CONSTRAINT "program_domains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_windows" ADD CONSTRAINT "application_windows_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_revisions" ADD CONSTRAINT "data_revisions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "user_watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "user_watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_submissions" ADD CONSTRAINT "university_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_submissions" ADD CONSTRAINT "program_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_submissions" ADD CONSTRAINT "program_submissions_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
