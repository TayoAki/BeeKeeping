import type pg from "pg";

/**
 * The settings runAction makes. One left out stays empty, as runAction
 * leaves it.
 */
export type AppSettings = {
  readonly orgId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly approverId?: string;
};

/**
 * Runs SQL as the app does: in a transaction of its own, as beekeeping_app,
 * with the settings runAction would make.
 */
export async function asApp<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.Client,
  settings: AppSettings,
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  await client.query("begin");
  try {
    await client.query(
      `select set_config('app.org_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.agent_id', $3, true),
              set_config('app.approver_id', $4, true)`,
      [
        settings.orgId ?? "",
        settings.userId ?? "",
        settings.agentId ?? "",
        settings.approverId ?? "",
      ],
    );
    await client.query("set local role beekeeping_app");
    const result = await client.query<Row>(text, values);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
