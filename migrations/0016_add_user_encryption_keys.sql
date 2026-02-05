-- User encryption keys for E2EE
-- The wrapped_key is the user's master encryption key, encrypted with their password-derived key
-- This ensures only the user with the correct password can decrypt their messages

CREATE TABLE IF NOT EXISTS user_encryption_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL UNIQUE,
  wrapped_key TEXT NOT NULL,        -- Base64 encoded AES-GCM wrapped master key
  key_iv TEXT NOT NULL,             -- Base64 encoded IV used for wrapping
  salt TEXT NOT NULL,               -- Base64 encoded PBKDF2 salt
  version INTEGER DEFAULT 1,        -- Key version for future rotation
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_encryption_keys_user ON user_encryption_keys(user_id);

-- Add is_encrypted flag to messages table to distinguish encrypted vs plaintext
ALTER TABLE messages ADD COLUMN is_encrypted INTEGER DEFAULT 0;
