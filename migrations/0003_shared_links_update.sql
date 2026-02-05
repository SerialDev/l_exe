-- Migration: 0003_shared_links_update.sql
-- Description: Add share_id and updated_at columns to shared_links table

-- Add share_id column (unique short identifier for public URLs)
ALTER TABLE shared_links ADD COLUMN share_id TEXT;

-- Add updated_at column
ALTER TABLE shared_links ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Create index for share_id lookups
CREATE INDEX IF NOT EXISTS idx_shared_links_share_id ON shared_links(share_id);

-- Update existing rows to have a share_id (use first 16 chars of id without dashes)
UPDATE shared_links 
SET share_id = REPLACE(SUBSTR(id, 1, 20), '-', '')
WHERE share_id IS NULL;

-- Update existing rows to have updated_at
UPDATE shared_links 
SET updated_at = created_at
WHERE updated_at IS NULL;
