-- Better Auth Tables Migration
-- Creates the tables required by better-auth library
-- Based on better-auth core schema: https://www.better-auth.com/docs/concepts/database#core-schema

-- Note: We're creating new tables with better_auth_ prefix to avoid conflicts
-- with existing auth tables. The existing tables will be deprecated.

-- ============================================================================
-- Better Auth User Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ba_user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    role TEXT DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ba_user_email ON ba_user(email);

-- ============================================================================
-- Better Auth Session Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ba_session (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ba_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ba_session_user_id ON ba_session(user_id);
CREATE INDEX IF NOT EXISTS idx_ba_session_token ON ba_session(token);
CREATE INDEX IF NOT EXISTS idx_ba_session_expires ON ba_session(expires_at);

-- ============================================================================
-- Better Auth Account Table (for OAuth and credentials)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ba_account (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at TEXT,
    refresh_token_expires_at TEXT,
    scope TEXT,
    id_token TEXT,
    password TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ba_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ba_account_user_id ON ba_account(user_id);
CREATE INDEX IF NOT EXISTS idx_ba_account_provider ON ba_account(provider_id, account_id);

-- ============================================================================
-- Better Auth Verification Table (for email verification, password reset)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ba_verification (
    id TEXT PRIMARY KEY NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ba_verification_identifier ON ba_verification(identifier);
CREATE INDEX IF NOT EXISTS idx_ba_verification_expires ON ba_verification(expires_at);

-- ============================================================================
-- Two Factor Authentication Table (for TOTP)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ba_two_factor (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES ba_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ba_two_factor_user_id ON ba_two_factor(user_id);
