-- Extend the existing user profile with Auth.js adapter fields.
ALTER TABLE "users"
ADD COLUMN "email_verified" TIMESTAMP(3),
ADD COLUMN "image" TEXT;

-- OAuth-compatible account records are included even though the MVP starts
-- with email links, so the maintained Auth.js Prisma adapter remains complete.
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- Session tokens are random opaque values. Only their owning user relation is
-- persisted; cookies receive the secure attributes from Auth.js.
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Auth.js stores a SHA-256 hash of each emailed token. The adapter deletes the
-- row atomically on lookup, making successful use single-use.
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key"
ON "accounts"("provider", "provider_account_id");

CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key"
ON "verification_tokens"("identifier", "token");

ALTER TABLE "accounts"
ADD CONSTRAINT "accounts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
