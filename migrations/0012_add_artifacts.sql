-- Migration: Add artifacts table for AI-generated content
-- Artifacts are renderable content blocks (React, HTML, Mermaid, etc.)

-- Create artifacts table
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('react', 'html', 'mermaid', 'svg', 'markdown', 'code', 'chart', 'table', 'image')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  metadata TEXT, -- JSON
  message_id TEXT,
  conversation_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

-- Create artifact_versions table for version history
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  title TEXT NOT NULL,
  changes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_user_id ON artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_id ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_message_id ON artifacts(message_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_updated_at ON artifacts(updated_at);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id ON artifact_versions(artifact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_versions_unique ON artifact_versions(artifact_id, version);
