-- Add Two-Factor Authentication columns to user table
-- Required by better-auth twoFactor plugin

ALTER TABLE user ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0;
ALTER TABLE user ADD COLUMN twoFactorSecret TEXT;
ALTER TABLE user ADD COLUMN twoFactorBackupCodes TEXT;
