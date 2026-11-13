-- CreateEnum
CREATE TYPE "PasswordLinkPurpose" AS ENUM ('RESET', 'INVITE');

-- CreateTable
CREATE TABLE "password_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "PasswordLinkPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_links_token_hash_key" ON "password_links"("token_hash");

-- CreateIndex
CREATE INDEX "password_links_user_id_purpose_idx" ON "password_links"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "password_links" ADD CONSTRAINT "password_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
