import pg from "pg";

/** Runs SQL as the database owner, who sets up rows around the app. */
export async function asOwner<Row extends Record<string, unknown>>(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * A demo organization with one member in the given role, as sign-up and
 * creating an organization leave it: a confirmed user, the organization and
 * the membership. Every name and address belongs to the demo company.
 */
export async function demoMember<Role extends string>(
  ownerUrl: string,
  name: string,
  role: Role,
): Promise<{ kind: "person"; orgId: string; userId: string; role: Role }> {
  const [user] = await asOwner<{ id: string }>(
    ownerUrl,
    "insert into users (name, email, email_verified) values ($1, $2, true) returning id",
    [name, `${name}@honeycomb-demo.test`],
  );
  const [organization] = await asOwner<{ id: string }>(
    ownerUrl,
    "insert into organizations (name, slug) values ($1, $2) returning id",
    [`${name} Studio (demo)`, `${name}-demo`],
  );
  if (!user || !organization) throw new Error("The demo rows weren't made.");
  await asOwner(
    ownerUrl,
    "insert into members (organization_id, user_id, role) values ($1, $2, $3)",
    [organization.id, user.id, role],
  );
  return { kind: "person", orgId: organization.id, userId: user.id, role };
}
