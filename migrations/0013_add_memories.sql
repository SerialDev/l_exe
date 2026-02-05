-- Migration: Add memories table for persistent user context
-- Memories store facts, preferences, and instructions across conversations

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'project', 'instruction', 'custom')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT, -- JSON
  source TEXT DEFAULT 'user' CHECK (source IN ('auto', 'user', 'agent')),
  conversation_id TEXT,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_type_key ON memories(user_id, type, key);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
