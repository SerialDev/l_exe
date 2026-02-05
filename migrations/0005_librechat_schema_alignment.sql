-- Migration: 0005_librechat_schema_alignment.sql
-- Description: Align schema with LibreChat's MongoDB schemas
-- Reference: LibreChat packages/data-schemas/src/schema/
-- Note: message_id and is_created_by_user already added by previous migration

-- ============================================================================
-- CONVERSATIONS TABLE - Add missing LibreChat fields
-- ============================================================================

ALTER TABLE conversations ADD COLUMN endpoint_type TEXT;
ALTER TABLE conversations ADD COLUMN chat_gpt_label TEXT;
ALTER TABLE conversations ADD COLUMN model_label TEXT;
ALTER TABLE conversations ADD COLUMN prompt_prefix TEXT;
ALTER TABLE conversations ADD COLUMN top_k INTEGER;
ALTER TABLE conversations ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE conversations ADD COLUMN file_ids TEXT;
ALTER TABLE conversations ADD COLUMN resend_files INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN image_detail TEXT;
ALTER TABLE conversations ADD COLUMN assistant_id TEXT;
ALTER TABLE conversations ADD COLUMN instructions TEXT;
ALTER TABLE conversations ADD COLUMN stop TEXT;
ALTER TABLE conversations ADD COLUMN icon_url TEXT;
ALTER TABLE conversations ADD COLUMN greeting TEXT;
ALTER TABLE conversations ADD COLUMN spec TEXT;
ALTER TABLE conversations ADD COLUMN max_context_tokens INTEGER;
ALTER TABLE conversations ADD COLUMN agent_id TEXT;

-- ============================================================================
-- MESSAGES TABLE - Add missing LibreChat fields
-- ============================================================================

ALTER TABLE messages ADD COLUMN user_id TEXT;
ALTER TABLE messages ADD COLUMN sender TEXT;
ALTER TABLE messages ADD COLUMN text TEXT;
ALTER TABLE messages ADD COLUMN unfinished INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN summary TEXT;
ALTER TABLE messages ADD COLUMN summary_token_count INTEGER;
ALTER TABLE messages ADD COLUMN client_id TEXT;
ALTER TABLE messages ADD COLUMN invocation_id INTEGER;
ALTER TABLE messages ADD COLUMN conversation_signature TEXT;
ALTER TABLE messages ADD COLUMN thread_id TEXT;
ALTER TABLE messages ADD COLUMN icon_url TEXT;
ALTER TABLE messages ADD COLUMN metadata TEXT;
ALTER TABLE messages ADD COLUMN files TEXT;
ALTER TABLE messages ADD COLUMN feedback TEXT;

-- ============================================================================
-- POPULATE NEW FIELDS
-- ============================================================================

UPDATE messages SET text = content WHERE text IS NULL AND content IS NOT NULL;
UPDATE messages SET sender = CASE 
  WHEN role = 'user' THEN 'User'
  WHEN role = 'assistant' THEN COALESCE(model, 'Assistant')
  WHEN role = 'system' THEN 'System'
  ELSE role
END WHERE sender IS NULL;

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assistant_id ON conversations(assistant_id);
