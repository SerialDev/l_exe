-- LibreChat D1 Database Schema
-- Migration: 0001_initial_schema.sql
-- Description: Complete initial schema for LibreChat on Cloudflare D1 (SQLite)

--------------------------------------------------------------------------------
-- USERS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    name TEXT,
    avatar TEXT,
    password_hash TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super')),
    provider TEXT DEFAULT 'local',
    provider_id TEXT,
    email_verified INTEGER DEFAULT 0,
    terms_accepted INTEGER DEFAULT 0,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    backup_codes TEXT, -- JSON array
    plugins TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

--------------------------------------------------------------------------------
-- SESSIONS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    refresh_token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

--------------------------------------------------------------------------------
-- CONVERSATIONS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    endpoint TEXT,
    model TEXT,
    system_message TEXT,
    temperature REAL,
    top_p REAL,
    frequency_penalty REAL,
    presence_penalty REAL,
    max_tokens INTEGER,
    is_archived INTEGER DEFAULT 0,
    tags TEXT, -- JSON array
    files TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expired_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_archived ON conversations(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_conversations_endpoint ON conversations(endpoint);
CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_expired_at ON conversations(expired_at);

--------------------------------------------------------------------------------
-- MESSAGES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    parent_message_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,
    model TEXT,
    endpoint TEXT,
    token_count INTEGER,
    finish_reason TEXT,
    error TEXT,
    attachments TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

--------------------------------------------------------------------------------
-- PRESETS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    endpoint TEXT,
    model TEXT,
    temperature REAL,
    top_p REAL,
    max_tokens INTEGER,
    system_message TEXT,
    tools TEXT, -- JSON array
    is_default INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
CREATE INDEX IF NOT EXISTS idx_presets_user_endpoint ON presets(user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_presets_user_default ON presets(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_presets_display_order ON presets(user_id, display_order);

--------------------------------------------------------------------------------
-- FILES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size INTEGER,
    r2_key TEXT,
    purpose TEXT,
    width INTEGER,
    height INTEGER,
    embedded INTEGER DEFAULT 0,
    metadata TEXT, -- JSON object
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_conversation_id ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_message_id ON files(message_id);
CREATE INDEX IF NOT EXISTS idx_files_r2_key ON files(r2_key);
CREATE INDEX IF NOT EXISTS idx_files_purpose ON files(purpose);
CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);

--------------------------------------------------------------------------------
-- AGENTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    model TEXT,
    endpoint TEXT,
    system_message TEXT,
    tools TEXT, -- JSON array
    tool_resources TEXT, -- JSON object
    model_parameters TEXT, -- JSON object
    is_public INTEGER DEFAULT 0,
    is_promoted INTEGER DEFAULT 0,
    versions TEXT, -- JSON array
    project_ids TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_is_public ON agents(is_public);
CREATE INDEX IF NOT EXISTS idx_agents_is_promoted ON agents(is_promoted);
CREATE INDEX IF NOT EXISTS idx_agents_endpoint ON agents(endpoint);
CREATE INDEX IF NOT EXISTS idx_agents_model ON agents(model);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

--------------------------------------------------------------------------------
-- SHARED LINKS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_links (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    is_public INTEGER DEFAULT 1,
    expires_at TEXT,
    view_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shared_links_conversation_id ON shared_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_user_id ON shared_links(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_is_public ON shared_links(is_public);
CREATE INDEX IF NOT EXISTS idx_shared_links_expires_at ON shared_links(expires_at);

--------------------------------------------------------------------------------
-- API KEYS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_provider ON api_keys(user_id, provider);

--------------------------------------------------------------------------------
-- TRANSACTIONS (Token Usage Tracking)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_type TEXT CHECK (token_type IN ('prompt', 'completion', 'total')),
    model TEXT,
    endpoint TEXT,
    tokens INTEGER NOT NULL,
    token_value REAL,
    rate REAL,
    context TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_model ON transactions(model);
CREATE INDEX IF NOT EXISTS idx_transactions_endpoint ON transactions(endpoint);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_token_type ON transactions(token_type);

--------------------------------------------------------------------------------
-- BALANCES (User Token Credits)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balances (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    token_credits REAL DEFAULT 0,
    auto_refill_enabled INTEGER DEFAULT 0,
    refill_interval_value INTEGER,
    refill_interval_unit TEXT CHECK (refill_interval_unit IN ('hour', 'day', 'week', 'month')),
    last_refill TEXT,
    refill_amount REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_balances_user_id ON balances(user_id);
CREATE INDEX IF NOT EXISTS idx_balances_last_refill ON balances(last_refill);

--------------------------------------------------------------------------------
-- ACL ENTRIES (Access Control List)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acl_entries (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'group', 'role')),
    principal_id TEXT NOT NULL,
    perm_bits INTEGER NOT NULL DEFAULT 0,
    role_id TEXT,
    granted_by TEXT,
    granted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE SET NULL,
    FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(resource_type, resource_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_acl_resource ON acl_entries(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_acl_principal ON acl_entries(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_acl_role_id ON acl_entries(role_id);
CREATE INDEX IF NOT EXISTS idx_acl_granted_by ON acl_entries(granted_by);

--------------------------------------------------------------------------------
-- ACCESS ROLES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    resource_type TEXT,
    perm_bits INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_access_roles_name ON access_roles(name);
CREATE INDEX IF NOT EXISTS idx_access_roles_resource_type ON access_roles(resource_type);

--------------------------------------------------------------------------------
-- GROUPS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    email TEXT,
    member_ids TEXT, -- JSON array
    source TEXT,
    id_on_source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);
CREATE INDEX IF NOT EXISTS idx_groups_email ON groups(email);
CREATE INDEX IF NOT EXISTS idx_groups_source ON groups(source, id_on_source);

--------------------------------------------------------------------------------
-- PROMPTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    group_id TEXT,
    author_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    labels TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES prompt_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prompts_group_id ON prompts(group_id);
CREATE INDEX IF NOT EXISTS idx_prompts_author_id ON prompts(author_id);
CREATE INDEX IF NOT EXISTS idx_prompts_type ON prompts(type);
CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at DESC);

--------------------------------------------------------------------------------
-- PROMPT GROUPS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT,
    category TEXT,
    command TEXT,
    oneliner TEXT,
    project_ids TEXT, -- JSON array
    production_id TEXT,
    number_of_generations INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (production_id) REFERENCES prompts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_groups_author_id ON prompt_groups(author_id);
CREATE INDEX IF NOT EXISTS idx_prompt_groups_name ON prompt_groups(name);
CREATE INDEX IF NOT EXISTS idx_prompt_groups_category ON prompt_groups(category);
CREATE INDEX IF NOT EXISTS idx_prompt_groups_command ON prompt_groups(command);
CREATE INDEX IF NOT EXISTS idx_prompt_groups_created_at ON prompt_groups(created_at DESC);

--------------------------------------------------------------------------------
-- CONVERSATION TAGS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tags_user_id ON conversation_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_user_tag ON conversation_tags(user_id, tag);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_position ON conversation_tags(user_id, position);

--------------------------------------------------------------------------------
-- TOOL CALLS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT, -- JSON object
    tool_output TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_user_id ON tool_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created_at ON tool_calls(created_at DESC);

--------------------------------------------------------------------------------
-- MCP SERVERS (Model Context Protocol)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    auth_type TEXT CHECK (auth_type IN ('none', 'bearer', 'api_key', 'oauth')),
    metadata TEXT, -- JSON object
    is_public INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_is_public ON mcp_servers(is_public);

--------------------------------------------------------------------------------
-- FULL-TEXT SEARCH (FTS5)
--------------------------------------------------------------------------------

-- Messages FTS for searching conversation content
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    id UNINDEXED,
    conversation_id UNINDEXED,
    content,
    content='messages',
    content_rowid='rowid'
);

-- Triggers to keep messages_fts in sync with messages table
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, id, conversation_id, content)
    VALUES (NEW.rowid, NEW.id, NEW.conversation_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, id, conversation_id, content)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.conversation_id, OLD.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, id, conversation_id, content)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.conversation_id, OLD.content);
    INSERT INTO messages_fts(rowid, id, conversation_id, content)
    VALUES (NEW.rowid, NEW.id, NEW.conversation_id, NEW.content);
END;

-- Conversations FTS for searching by title
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
    id UNINDEXED,
    user_id UNINDEXED,
    title,
    content='conversations',
    content_rowid='rowid'
);

-- Triggers to keep conversations_fts in sync
CREATE TRIGGER IF NOT EXISTS conversations_fts_insert AFTER INSERT ON conversations BEGIN
    INSERT INTO conversations_fts(rowid, id, user_id, title)
    VALUES (NEW.rowid, NEW.id, NEW.user_id, NEW.title);
END;

CREATE TRIGGER IF NOT EXISTS conversations_fts_delete AFTER DELETE ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, id, user_id, title)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.user_id, OLD.title);
END;

CREATE TRIGGER IF NOT EXISTS conversations_fts_update AFTER UPDATE ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, id, user_id, title)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.user_id, OLD.title);
    INSERT INTO conversations_fts(rowid, id, user_id, title)
    VALUES (NEW.rowid, NEW.id, NEW.user_id, NEW.title);
END;

-- Prompts FTS for searching prompt content
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
    id UNINDEXED,
    prompt,
    content='prompts',
    content_rowid='rowid'
);

-- Triggers to keep prompts_fts in sync
CREATE TRIGGER IF NOT EXISTS prompts_fts_insert AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(rowid, id, prompt)
    VALUES (NEW.rowid, NEW.id, NEW.prompt);
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_delete AFTER DELETE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, id, prompt)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.prompt);
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_update AFTER UPDATE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, id, prompt)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.prompt);
    INSERT INTO prompts_fts(rowid, id, prompt)
    VALUES (NEW.rowid, NEW.id, NEW.prompt);
END;

--------------------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
--------------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS users_updated_at AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS conversations_updated_at AFTER UPDATE ON conversations
BEGIN
    UPDATE conversations SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS presets_updated_at AFTER UPDATE ON presets
BEGIN
    UPDATE presets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS agents_updated_at AFTER UPDATE ON agents
BEGIN
    UPDATE agents SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS api_keys_updated_at AFTER UPDATE ON api_keys
BEGIN
    UPDATE api_keys SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS balances_updated_at AFTER UPDATE ON balances
BEGIN
    UPDATE balances SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS groups_updated_at AFTER UPDATE ON groups
BEGIN
    UPDATE groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS prompt_groups_updated_at AFTER UPDATE ON prompt_groups
BEGIN
    UPDATE prompt_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS conversation_tags_updated_at AFTER UPDATE ON conversation_tags
BEGIN
    UPDATE conversation_tags SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS mcp_servers_updated_at AFTER UPDATE ON mcp_servers
BEGIN
    UPDATE mcp_servers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

--------------------------------------------------------------------------------
-- DEFAULT ACCESS ROLES
--------------------------------------------------------------------------------
INSERT OR IGNORE INTO access_roles (id, name, description, resource_type, perm_bits)
VALUES
    ('role_owner', 'Owner', 'Full access including delete and transfer', NULL, 255),
    ('role_admin', 'Admin', 'Full access except transfer ownership', NULL, 127),
    ('role_editor', 'Editor', 'Can read and write', NULL, 6),
    ('role_viewer', 'Viewer', 'Read-only access', NULL, 1),
    ('role_agent_user', 'Agent User', 'Can use agents', 'agent', 1),
    ('role_agent_editor', 'Agent Editor', 'Can edit agents', 'agent', 6),
    ('role_prompt_user', 'Prompt User', 'Can use prompts', 'prompt', 1),
    ('role_prompt_editor', 'Prompt Editor', 'Can edit prompts', 'prompt', 6);
