-- Add subscription/access control system
-- This controls which users can access AI provider APIs

-- User subscription status and access control
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  
  -- Subscription tier: 'free', 'basic', 'pro', 'admin'
  -- 'free' = no API access (or limited)
  -- 'basic' = basic models only
  -- 'pro' = all models
  -- 'admin' = full access + admin panel
  tier TEXT NOT NULL DEFAULT 'free',
  
  -- Specific provider access (JSON array of allowed providers)
  -- e.g., ["openai", "anthropic"] or null for tier-based defaults
  allowed_providers TEXT,
  
  -- Usage limits (null = unlimited for tier)
  monthly_token_limit INTEGER,
  monthly_request_limit INTEGER,
  
  -- Current usage (reset monthly)
  tokens_used INTEGER DEFAULT 0,
  requests_used INTEGER DEFAULT 0,
  usage_reset_at TEXT,
  
  -- Stripe integration (for future)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_status TEXT, -- 'active', 'canceled', 'past_due', etc.
  
  -- Manual override by admin
  manually_granted INTEGER DEFAULT 0,
  granted_by TEXT,
  granted_at TEXT,
  grant_reason TEXT,
  
  -- Expiration (null = never expires)
  expires_at TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tier ON user_subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);

-- Access logs for auditing and usage tracking
CREATE TABLE IF NOT EXISTS api_access_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  -- Request details
  endpoint TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  
  -- Token usage
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  
  -- Cost tracking (in microcents for precision)
  estimated_cost_microcents INTEGER,
  
  -- Request metadata
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  
  -- Status
  success INTEGER DEFAULT 1,
  error_message TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for usage queries
CREATE INDEX IF NOT EXISTS idx_api_access_logs_user_id ON api_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_access_logs_created_at ON api_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_access_logs_provider ON api_access_logs(provider);

-- Allowlist for deploy-time access control
-- Users in this list get automatic access based on their tier setting
CREATE TABLE IF NOT EXISTS access_allowlist (
  id TEXT PRIMARY KEY,
  
  -- Can be email or user_id
  identifier TEXT NOT NULL UNIQUE,
  identifier_type TEXT NOT NULL DEFAULT 'email', -- 'email' or 'user_id'
  
  -- What tier to grant
  tier TEXT NOT NULL DEFAULT 'pro',
  
  -- Optional: specific providers only
  allowed_providers TEXT,
  
  -- Metadata
  added_by TEXT,
  reason TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_allowlist_identifier ON access_allowlist(identifier);
