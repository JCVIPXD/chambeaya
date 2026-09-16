-- A Google identity authenticates the user but never supplies a password.
-- Older Google accounts were created with an inaccessible random hash, so make
-- them finish the one-time local-password step on their next Google login.
ALTER TABLE "User"
ADD COLUMN "localPasswordConfigured" BOOLEAN NOT NULL DEFAULT true;

UPDATE "User"
SET "localPasswordConfigured" = false
WHERE EXISTS (
  SELECT 1
  FROM "ExternalIdentity"
  WHERE "ExternalIdentity"."userId" = "User"."id"
    AND "ExternalIdentity"."provider" = 'GOOGLE'
);
