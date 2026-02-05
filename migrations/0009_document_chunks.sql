-- Document chunks for RAG (Retrieval Augmented Generation)
-- Stores embedded document chunks for semantic search

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT NOT NULL,  -- JSON array of floats
    chunk_index INTEGER NOT NULL,
    metadata TEXT,  -- JSON object for additional metadata
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_document_chunks_file_id ON document_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_file_user ON document_chunks(file_id, user_id);
