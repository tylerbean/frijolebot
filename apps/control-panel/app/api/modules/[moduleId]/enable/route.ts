export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { publish } from '@/lib/redis';

/**
 * POST /api/modules/[moduleId]/enable
 * Enable a module for a specific guild
 *
 * Request body:
 *   - guildId: Discord guild ID (required)
 *   - config: Module configuration object (optional)
 *   - enabledBy: User ID who enabled the module (optional)
 */
export async function POST(
  request: Request,
  { params }: { params: { moduleId: string } }
) {
  try {
    const { moduleId } = params;
    const body = await request.json();
    const { guildId, config = {}, enabledBy = null } = body;

    if (!guildId) {
      return NextResponse.json(
        { error: 'guildId is required in request body' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Verify module exists
    const moduleCheck = await pool.query(
      'SELECT id, name, dependencies FROM modules WHERE id = $1',
      [moduleId]
    );

    if (moduleCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Module not found' },
        { status: 404 }
      );
    }

    const module = moduleCheck.rows[0];

    // Validate dependencies are enabled
    if (module.dependencies && module.dependencies.length > 0) {
      const depQuery = `
        SELECT module_id, enabled
        FROM module_states
        WHERE module_id = ANY($1::text[]) AND guild_id = $2
      `;

      const depResult = await pool.query(depQuery, [module.dependencies, guildId]);
      const enabledDeps = depResult.rows.filter((r: any) => r.enabled).map((r: any) => r.module_id);

      const missingDeps = module.dependencies.filter(
        (dep: string) => !enabledDeps.includes(dep)
      );

      if (missingDeps.length > 0) {
        return NextResponse.json(
          {
            error: 'Required dependencies not enabled',
            missingDependencies: missingDeps
          },
          { status: 400 }
        );
      }
    }

    // Enable the module
    const enableQuery = `
      INSERT INTO module_states (module_id, guild_id, enabled, config, enabled_by, enabled_at)
      VALUES ($1, $2, TRUE, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (module_id, guild_id) DO UPDATE SET
        enabled = TRUE,
        config = EXCLUDED.config,
        enabled_by = EXCLUDED.enabled_by,
        enabled_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(enableQuery, [
      moduleId,
      guildId,
      JSON.stringify(config),
      enabledBy
    ]);

    // Invalidate module cache
    try {
      await publish('modules.invalidate', { moduleId, guildId });
    } catch (redisError) {
      console.warn('Failed to publish module invalidation:', redisError);
      // Continue even if Redis fails
    }

    return NextResponse.json({
      success: true,
      module: {
        id: result.rows[0].module_id,
        guildId: result.rows[0].guild_id,
        enabled: result.rows[0].enabled,
        config: result.rows[0].config,
        enabledBy: result.rows[0].enabled_by,
        enabledAt: result.rows[0].enabled_at
      }
    });

  } catch (error: any) {
    console.error('Error enabling module:', error);
    return NextResponse.json(
      { error: 'Failed to enable module', details: error.message },
      { status: 500 }
    );
  }
}
