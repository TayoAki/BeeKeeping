// What an organization sets up once, when it's created.
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./auth.ts";
import { orgIsolation } from "./tenancy.ts";

export const organizationSettings = pgTable(
  "organization_settings",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * The ISO 4217 code the books are kept in. It never changes: a trigger
     * in migration 0002 refuses, and the app's role can't delete the row.
     */
    homeCurrency: text("home_currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "organization_settings_home_currency_check",
      sql`${table.homeCurrency} ~ '^[A-Z]{3}$'`,
    ),
    orgIsolation("organization_settings", table.orgId),
  ],
);
