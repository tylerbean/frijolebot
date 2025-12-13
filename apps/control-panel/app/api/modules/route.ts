export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/modules
 * List all modules with their state for a specific guild
 *
 * Query params:
 *   - guildId: Discord guild ID (required)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guildId = searchParams.get('guildId');

    if (!guildId) {
      return NextResponse.json(
        { error: 'guildId query parameter is required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Get all modules with their guild-specific state
    const query = `
      SELECT
        m.id,
        m.name,
        m.description,
        m.version,
        m.dependencies,
        m.config_schema,
        m.default_config,
        COALESCE(ms.enabled, false) as enabled,
        ms.config as current_config,
        ms.enabled_by,
        ms.enabled_at,
        ms.disabled_at
      FROM modules m
      LEFT JOIN module_states ms ON m.id = ms.module_id AND ms.guild_id = $1
      ORDER BY m.name ASC
    `;

    const result = await pool.query(query, [guildId]);

    const modules = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      dependencies: row.dependencies || [],
      configSchema: row.config_schema,
      defaultConfig: row.default_config,
      enabled: row.enabled,
      currentConfig: row.current_config,
      enabledBy: row.enabled_by,
      enabledAt: row.enabled_at,
      disabledAt: row.disabled_at
    }));

    return NextResponse.json({ modules, guildId });

  } catch (error: any) {
    console.error('Error fetching modules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch modules', details: error.message },
      { status: 500 }
    );
  }
}
