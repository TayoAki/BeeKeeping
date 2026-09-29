// The two roles the app's connections run as. Migrations create them, so
// drizzle-kit only refers to them.
import { pgRole } from "drizzle-orm/pg-core";

/** Organizations' data: every table with org_id, one organization at a time. */
export const appRole = pgRole("beekeeping_app").existing();

/** Sign-in's tables, which only Better Auth's connections reach. */
export const authRole = pgRole("beekeeping_auth").existing();
