-- Add summary columns to conversations table for context summarization feature
-- Migration: 0010_add_conversation_summary.sql

-- Add summary column for storing AI-generated conversation summaries
ALTER TABLE conversations ADD COLUMN summary TEXT;

-- Add token count for the summary
ALTER TABLE conversations ADD COLUMN summary_token_count INTEGER;

-- Index for querying conversations with summaries
CREATE INDEX IF NOT EXISTS idx_conversations_has_summary ON conversations(user_id) WHERE summary IS NOT NULL;
