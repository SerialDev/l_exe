/**
 * Migration endpoint for better-auth
 * 
 * This endpoint runs the database migrations for better-auth tables.
 * Should only be called once during initial setup.
 * 
 * Security: In production, this should be protected or removed after initial setup.
 */

import { Hono } from 'hono';
import { getMigrations } from 'better-auth/db';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../types';

const migrate = new Hono<{ Bindings: Env }>();

/**
 * POST /migrate
 * Run better-auth database migrations
 */
migrate.post('/', async (c) => {
  // Simple protection - require a secret header in production
  const migrationSecret = c.req.header('X-Migration-Secret');
  if (c.env.DOMAIN_SERVER?.includes('localhost') === false) {
    // In production, require a secret
    if (migrationSecret !== c.env.JWT_SECRET?.substring(0, 16)) {
      return c.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, 401);
    }
  }

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
