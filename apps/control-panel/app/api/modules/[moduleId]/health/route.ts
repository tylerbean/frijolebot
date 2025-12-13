export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/modules/[moduleId]/health
 * Get health status of a module for a specific guild
 *
 * Query params:
 *   - guildId: Discord guild ID (required)
 */
export async function GET(
  request: Request,
  { params }: { params: { moduleId: string } }
) {
  try {
    const { moduleId } = params;
    const { searchParams } = new URL(request.url);
    const guildId = searchParams.get('guildId');

    if (!guildId) {
      return NextResponse.json(
        { error: 'guildId query parameter is required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Get module info and state
    const query = `
      SELECT
        m.id,
        m.name,
        m.description,
        m.version,
        m.dependencies,
        COALESCE(ms.enabled, false) as enabled,
        ms.config,
        ms.enabled_at,
        ms.disabled_at,
        ms.updated_at
      FROM modules m
      LEFT JOIN module_states ms ON m.id = ms.module_id AND ms.guild_id = $2
      WHERE m.id = $1
    `;

    const result = await pool.query(query, [moduleId, guildId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: 'not_found',
          details: { moduleId }
        },
        { status: 404 }
      );
    }

    const row = result.rows[0];

    // Determine health status
    let status = 'disabled';
    const details: any = {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      version: row.version
    };

    if (row.enabled) {
      // Module is enabled, check dependencies
      if (row.dependencies && row.dependencies.length > 0) {
        const depQuery = `
          SELECT module_id, enabled
          FROM module_states
          WHERE module_id = ANY($1::text[]) AND guild_id = $2
        `;

        const depResult = await pool.query(depQuery, [row.dependencies, guildId]);
        const enabledDeps = depResult.rows.filter((r: any) => r.enabled).map((r: any) => r.module_id);

        const missingDeps = row.dependencies.filter(
          (dep: string) => !enabledDeps.includes(dep)
        );

        if (missingDeps.length > 0) {
          status = 'unhealthy';
          details.missingDependencies = missingDeps;
          details.reason = 'Required dependencies are not enabled';
        } else {
          status = 'healthy';
          details.dependenciesOk = true;
        }
      } else {
        status = 'healthy';
      }

      details.enabledAt = row.enabled_at;
      details.config = row.config;
    } else {
      details.disabledAt = row.disabled_at;
    }

    details.lastUpdate = row.updated_at;

    return NextResponse.json({
      status,
      details,
      guildId
    });

  } catch (error: any) {
    console.error('Error fetching module health:', error);
    return NextResponse.json(
      {
        status: 'error',
        details: { error: error.message }
      },
      { status: 500 }
    );
  }
}
