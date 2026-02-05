-- Migration: 0004_add_conversation_id.sql
-- Description: Add conversation_id column to match LibreChat schema
-- LibreChat uses separate id (row ID) and conversation_id (logical conversation identifier)

-- Add conversation_id column
ALTER TABLE conversations ADD COLUMN conversation_id TEXT;

-- Populate existing rows with their id as conversation_id
UPDATE conversations SET conversation_id = id WHERE conversation_id IS NULL;

-- Create index for conversation_id lookups
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_id ON conversations(conversation_id);

-- Update messages table to ensure foreign key references work
-- (messages.conversation_id references conversations.conversation_id, not conversations.id)
