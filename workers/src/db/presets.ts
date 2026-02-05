/**
 * Preset Repository
 * Type-safe D1 queries for preset management
 *
 * Note: Default preset functionality requires passing a KV namespace
 * since the schema doesn't include an is_default column.
 * The default is stored in KV with key pattern: `default_preset:{userId}`
 */

/**
 * Preset entity as stored in the database
 */
export interface PresetRow {
  id: string;
  user_id: string;
  title: string;
  endpoint: string;
  model: string;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  system_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Preset entity with normalized field names
 */
export interface Preset {
  id: string;
  userId: string;
  title: string;
  endpoint: string;
  model: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  systemMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data required to create a new preset
 */
export interface CreatePresetData {
  id: string;
  userId: string;
  title: string;
  endpoint: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  systemMessage?: string;
}

/**
 * Data that can be updated on a preset
 */
export interface UpdatePresetData {
  title?: string;
  endpoint?: string;
  model?: string;
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  systemMessage?: string | null;
}

/**
 * Converts a database row to a Preset entity
 */
function rowToPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    endpoint: row.endpoint,
    model: row.model,
    temperature: row.temperature,
    topP: row.top_p,
    maxTokens: row.max_tokens,
    systemMessage: row.system_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get the KV key for a user's default preset
 */
function getDefaultKey(userId: string): string {
  return `default_preset:${userId}`;
}

/**
 * Find a preset by its unique ID
 * @param db - D1 database instance
 * @param id - Preset ID
 * @returns Preset or null if not found
 */
export async function findById(db: D1Database, id: string): Promise<Preset | null> {
  const stmt = db.prepare('SELECT * FROM presets WHERE id = ?').bind(id);
  const result = await stmt.first<PresetRow>();
  return result ? rowToPreset(result) : null;
}

/**
 * Find all presets for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns List of presets ordered by title
 */
export async function findByUser(db: D1Database, userId: string): Promise<Preset[]> {
  const stmt = db
    .prepare('SELECT * FROM presets WHERE user_id = ? ORDER BY title ASC')
    .bind(userId);
  const result = await stmt.all<PresetRow>();
  return (result.results ?? []).map(rowToPreset);
}

/**
 * Find presets by endpoint
 * @param db - D1 database instance
 * @param userId - User ID
 * @param endpoint - Endpoint filter
 * @returns List of presets for the endpoint
 */
export async function findByEndpoint(
  db: D1Database,
  userId: string,
  endpoint: string
): Promise<Preset[]> {
  const stmt = db
    .prepare(
      'SELECT * FROM presets WHERE user_id = ? AND endpoint = ? ORDER BY title ASC'
    )
    .bind(userId, endpoint);
  const result = await stmt.all<PresetRow>();
  return (result.results ?? []).map(rowToPreset);
}

/**
 * Get the default preset for a user (if any)
 * @param db - D1 database instance
 * @param kv - KV namespace for storing default preset ID
 * @param userId - User ID
 * @returns Default preset or null if none set
 */
export async function getDefault(
  db: D1Database,
  kv: KVNamespace,
  userId: string
): Promise<Preset | null> {
  const defaultId = await kv.get(getDefaultKey(userId));
  if (!defaultId) {
    return null;
  }
  return findById(db, defaultId);
}

/**
 * Create a new preset
 * @param db - D1 database instance
 * @param preset - Preset data to insert
 * @returns Created preset
 * @throws Error if creation fails
 */
export async function create(db: D1Database, preset: CreatePresetData): Promise<Preset> {
  const now = new Date().toISOString();

  const stmt = db
    .prepare(
      `INSERT INTO presets (id, user_id, title, endpoint, model, temperature, top_p, max_tokens, system_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      preset.id,
      preset.userId,
      preset.title,
      preset.endpoint,
      preset.model,
      preset.temperature ?? null,
      preset.topP ?? null,
      preset.maxTokens ?? null,
      preset.systemMessage ?? null,
      now,
      now
    );

  await stmt.run();

  const created = await findById(db, preset.id);
  if (!created) {
    throw new Error('Failed to create preset');
  }
  return created;
}

/**
 * Update an existing preset
 * @param db - D1 database instance
 * @param id - Preset ID
 * @param data - Fields to update
 * @returns Updated preset or null if not found
 */
export async function update(
  db: D1Database,
  id: string,
  data: UpdatePresetData
): Promise<Preset | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.endpoint !== undefined) {
    fields.push('endpoint = ?');
    values.push(data.endpoint);
  }
  if (data.model !== undefined) {
    fields.push('model = ?');
    values.push(data.model);
  }
  if (data.temperature !== undefined) {
    fields.push('temperature = ?');
    values.push(data.temperature);
  }
  if (data.topP !== undefined) {
    fields.push('top_p = ?');
    values.push(data.topP);
  }
  if (data.maxTokens !== undefined) {
    fields.push('max_tokens = ?');
    values.push(data.maxTokens);
  }
  if (data.systemMessage !== undefined) {
    fields.push('system_message = ?');
    values.push(data.systemMessage);
  }

  if (fields.length === 0) {
    return findById(db, id);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = db
    .prepare(`UPDATE presets SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values);

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return null;
  }

  return findById(db, id);
}

/**
 * Delete a preset by ID
 * @param db - D1 database instance
 * @param id - Preset ID
 * @param kv - Optional KV namespace to clear default if this preset was the default
 * @param userId - Required if kv is provided, to identify the user's default key
 * @returns True if deleted, false if not found
 */
export async function deletePreset(
  db: D1Database,
  id: string,
  kv?: KVNamespace,
  userId?: string
): Promise<boolean> {
  // If KV is provided, check and clear default if needed
  if (kv && userId) {
    const defaultId = await kv.get(getDefaultKey(userId));
    if (defaultId === id) {
      await kv.delete(getDefaultKey(userId));
    }
  }

  const stmt = db.prepare('DELETE FROM presets WHERE id = ?').bind(id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Set a preset as the default for a user
 * @param db - D1 database instance
 * @param kv - KV namespace for storing default preset ID
 * @param userId - User ID
 * @param presetId - Preset ID to set as default
 * @returns True if successful, false if preset not found or doesn't belong to user
 */
export async function setDefault(
  db: D1Database,
  kv: KVNamespace,
  userId: string,
  presetId: string
): Promise<boolean> {
  // Verify the preset exists and belongs to the user
  const preset = await findById(db, presetId);
  if (!preset || preset.userId !== userId) {
    return false;
  }

  // Store the default preset ID in KV
  await kv.put(getDefaultKey(userId), presetId);
  return true;
}

/**
 * Clear the default preset for a user
 * @param kv - KV namespace
 * @param userId - User ID
 */
export async function clearDefault(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(getDefaultKey(userId));
}

/**
 * Clone a preset with a new ID and optional modifications
 * @param db - D1 database instance
 * @param presetId - ID of preset to clone
 * @param newId - ID for the cloned preset
 * @param overrides - Optional fields to override in the clone
 * @returns Cloned preset or null if original not found
 */
export async function clone(
  db: D1Database,
  presetId: string,
  newId: string,
  overrides?: Partial<CreatePresetData>
): Promise<Preset | null> {
  const original = await findById(db, presetId);
  if (!original) {
    return null;
  }

  return create(db, {
    id: newId,
    userId: original.userId,
    title: overrides?.title ?? `${original.title} (Copy)`,
    endpoint: overrides?.endpoint ?? original.endpoint,
    model: overrides?.model ?? original.model,
    temperature: overrides?.temperature ?? original.temperature ?? undefined,
    topP: overrides?.topP ?? original.topP ?? undefined,
    maxTokens: overrides?.maxTokens ?? original.maxTokens ?? undefined,
    systemMessage: overrides?.systemMessage ?? original.systemMessage ?? undefined,
  });
}

/**
 * Count presets for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Total count of presets
 */
export async function countByUser(db: D1Database, userId: string): Promise<number> {
  const stmt = db
    .prepare('SELECT COUNT(*) as count FROM presets WHERE user_id = ?')
    .bind(userId);
  const result = await stmt.first<{ count: number }>();
  return result?.count ?? 0;
}

/**
 * Check if a preset belongs to a user
 * @param db - D1 database instance
 * @param presetId - Preset ID
 * @param userId - User ID
 * @returns True if the preset belongs to the user
 */
export async function isOwner(
  db: D1Database,
  presetId: string,
  userId: string
): Promise<boolean> {
  const stmt = db
    .prepare('SELECT 1 FROM presets WHERE id = ? AND user_id = ?')
    .bind(presetId, userId);
  const result = await stmt.first();
  return result !== null;
}
