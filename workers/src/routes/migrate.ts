/**
 * Migration endpoint for better-auth
 * 
 * This endpoint runs the database migrations for better-auth tables.
 * Should only be called once during initial setup.
 * 
 * SECURITY: These endpoints are protected and require either:
 * 1. Correct MIGRATION_SECRET header (in production), OR
 * 2. Development environment (localhost)
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { getMigrations } from 'better-auth/db';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../types';
import { timingSafeEqual } from '../services/crypto';

const migrate = new Hono<{ Bindings: Env }>();

/**
 * SECURITY: Migration authorization middleware
 * Requires correct MIGRATION_SECRET header in production
 */
async function requireMigrationAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const isLocalhost = c.env.DOMAIN_SERVER?.includes('localhost') === true ||
                      c.env.ENVIRONMENT === 'development';
  
  // In development/localhost, allow without auth for initial setup
  if (isLocalhost) {
    return next();
  }
  
  // In production, require migration secret header
  const migrationSecret = c.req.header('X-Migration-Secret');
  const expectedSecret = c.env.MIGRATION_SECRET;
  
  // SECURITY: Migration secret must be configured in production
  if (!expectedSecret || expectedSecret.length < 32) {
    console.error('MIGRATION_SECRET not configured or too short');
    return c.json({ 
      success: false, 
      error: 'Migration not configured for this environment' 
    }, 503);
  }
  
  // SECURITY: Use timing-safe comparison
  if (!migrationSecret || migrationSecret.length !== expectedSecret.length) {
    return c.json({ 
      success: false, 
      error: 'Unauthorized' 
    }, 401);
  }
  
  const secretsMatch = await timingSafeEqual(migrationSecret, expectedSecret);
  if (!secretsMatch) {
    return c.json({ 
      success: false, 
      error: 'Unauthorized' 
    }, 401);
  }
  
  return next();
}

// Apply migration auth to all routes
migrate.use('*', requireMigrationAuth);

/**
 * POST /migrate
 * Run better-auth database migrations
 */
migrate.post('/', async (c) => {
  try {
    // Create Kysely instance with D1 dialect
    const db = new Kysely<any>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const authConfig = {
      database: {
        db,
        type: 'sqlite' as const,
      },
      // We need to include basic config for migrations to work
      baseURL: c.env.DOMAIN_SERVER,
      secret: c.env.JWT_SECRET,
      emailAndPassword: {
        enabled: true,
      },
    };

    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authConfig);

    if (toBeCreated.length === 0 && toBeAdded.length === 0) {
      return c.json({
        success: true,
        message: 'No migrations needed - database is up to date',
        tablesCreated: [],
        tablesUpdated: [],
      });
    }

    // Log what will be done
    console.log('Tables to be created:', toBeCreated.map(t => t.table));
    console.log('Tables to be updated:', toBeAdded.map(t => t.table));

    // Run migrations
    await runMigrations();

    return c.json({
      success: true,
      message: 'Migrations completed successfully',
      tablesCreated: toBeCreated.map(t => t.table),
      tablesUpdated: toBeAdded.map(t => t.table),
    });
  } catch (error) {
    console.error('Migration error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Migration failed',
    }, 500);
  }
});

/**
 * GET /migrate/status
 * Check migration status
 */
migrate.get('/status', async (c) => {
  try {
    // Create Kysely instance with D1 dialect
    const db = new Kysely<any>({
      dialect: new D1Dialect({ database: c.env.DB }),
    });

    const authConfig = {
      database: {
        db,
        type: 'sqlite' as const,
      },
      baseURL: c.env.DOMAIN_SERVER,
      secret: c.env.JWT_SECRET,
      emailAndPassword: {
        enabled: true,
      },
    };

    const { toBeCreated, toBeAdded } = await getMigrations(authConfig);

    return c.json({
      success: true,
      needsMigration: toBeCreated.length > 0 || toBeAdded.length > 0,
      pendingCreations: toBeCreated.map(t => t.table),
      pendingUpdates: toBeAdded.map(t => t.table),
    });
  } catch (error) {
    console.error('Migration status error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check migration status',
    }, 500);
  }
});

export { migrate };
export default migrate;
