-- Set when an administrator gives someone a temporary password, cleared when they choose their own.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
