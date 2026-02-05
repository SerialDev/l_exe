-- Add pinned/favorite column to conversations table
-- Migration: 0011_add_conversation_pinned.sql

-- Add is_pinned column for pinning/favoriting conversations
ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0;

-- Index for efficient querying of pinned conversations
CREATE INDEX IF NOT EXISTS idx_conversations_user_pinned ON conversations(user_id, is_pinned);
