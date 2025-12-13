export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { publish } from '@/lib/redis';

/**
 * POST /api/modules/[moduleId]/disable
 * Disable a module for a specific guild
 *
 * Request body:
 *   - guildId: Discord guild ID (required)
 */
export async function POST(
  request: Request,
  { params }: { params: { moduleId: string } }
) {
  try {
    const { moduleId } = params;
    const body = await request.json();
    const { guildId } = body;

    if (!guildId) {
      return NextResponse.json(
        { error: 'guildId is required in request body' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Verify module exists
    const moduleCheck = await pool.query(
      'SELECT id, name FROM modules WHERE id = $1',
      [moduleId]
    );

    if (moduleCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Module not found' },
        { status: 404 }
      );
    }

    // Check if any other modules depend on this one
    const dependentModulesQuery = `
      SELECT m.id, m.name
      FROM modules m
      JOIN module_states ms ON m.id = ms.module_id AND ms.guild_id = $1
      WHERE ms.enabled = TRUE
        AND $2 = ANY(m.dependencies)
    `;

    const dependentResult = await pool.query(dependentModulesQuery, [guildId, moduleId]);

    if (dependentResult.rows.length > 0) {
      const dependentModules = dependentResult.rows.map((r: any) => ({
        id: r.id,
        name: r.name
      }));

      return NextResponse.json(
        {
          error: 'Cannot disable module: other modules depend on it',
          dependentModules
        },
        { status: 400 }
      );
    }

    // Disable the module
    const disableQuery = `
      UPDATE module_states
      SET enabled = FALSE,
          disabled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE module_id = $1 AND guild_id = $2
      RETURNING *
    `;

    const result = await pool.query(disableQuery, [moduleId, guildId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Module state not found or already disabled' },
        { status: 404 }
      );
    }

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
        disabledAt: result.rows[0].disabled_at
      }
    });

  } catch (error: any) {
    console.error('Error disabling module:', error);
    return NextResponse.json(
      { error: 'Failed to disable module', details: error.message },
      { status: 500 }
    );
  }
}
