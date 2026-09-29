-- Tenancy. Every table gets row-level security. Sign-in's tables move to a
-- role of their own, beekeeping_auth, that only Better Auth's connections
-- use: the app's role, beekeeping_app, loses every right on them, so an
-- action's query can't read a password hash, a session token or a
-- two-factor secret by mistake. The app's login holds both roles, so this
-- guards against mistakes, not against SQL that an attacker writes.
-- Tables that hold an organization's data show beekeeping_app only the rows
-- of the organization its transaction set in app.org_id.
--
-- On a server set up before this migration, the app's login holds only
-- beekeeping_app. Right after this migration runs, an admin grants it
-- beekeeping_auth, as AGENTS.md says. Until then nobody can sign in, and
-- the health check answers 503.
--
-- Row-level security isn't forced. The app's roles never own a table, and
-- the health check refuses a login that can act as the owner. Migrations run
-- as the owner and must see every row to change data. This migration changes
-- no data.

-- Roles belong to the whole server, and another database on it may be making
-- the same role at this moment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beekeeping_auth') THEN
    BEGIN
      CREATE ROLE beekeeping_auth NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
END
$$;
--> statement-breakpoint
-- A role made earlier by hand must not be able to log in, skip row-level
-- security or use another role's rights. Fail rather than run as such a role.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'beekeeping_auth'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
           OR EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid))
  ) THEN
    RAISE EXCEPTION 'beekeeping_auth can log in, bypass row-level security, create roles or databases, or use another role''s rights. A superuser must remove those before this migration can run.';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO beekeeping_auth;
--> statement-breakpoint
-- The organization and the person a transaction acts for, from the settings
-- the action context sets with set local. Unset, they are null, and a policy
-- that compares with null matches nothing.
CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"home_currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_home_currency_check" CHECK ("organization_settings"."home_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "accounts_auth_only" ON "accounts" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "invitations_auth_only" ON "invitations" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "members_auth_only" ON "members" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "organizations_auth_only" ON "organizations" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "rate_limits_auth_only" ON "rate_limits" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_auth_only" ON "sessions" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "two_factors_auth_only" ON "two_factors" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_auth_only" ON "users" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "verifications_auth_only" ON "verifications" AS PERMISSIVE FOR ALL TO "beekeeping_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "organization_settings_org_isolation" ON "organization_settings" AS PERMISSIVE FOR ALL TO "beekeeping_app" USING ("organization_settings"."org_id" = (select current_org_id())) WITH CHECK ("organization_settings"."org_id" = (select current_org_id()));
--> statement-breakpoint
-- Sign-in's tables: Better Auth's role reads and writes them, and the app's
-- role can't touch them.
REVOKE ALL ON "accounts", "invitations", "members", "organizations", "rate_limits", "sessions", "two_factors", "users", "verifications" FROM beekeeping_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "accounts", "invitations", "members", "organizations", "rate_limits", "sessions", "two_factors", "users", "verifications" TO beekeeping_auth;
--> statement-breakpoint
-- An organization's home currency never changes, since every amount in its
-- books is kept in it. The app's role can't delete the row to set it up
-- again either. Deleting the organization still removes the row, through
-- the foreign key.
CREATE FUNCTION keep_home_currency() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.home_currency IS DISTINCT FROM OLD.home_currency THEN
    RAISE EXCEPTION 'An organization''s home currency never changes.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organization_settings_keep_home_currency
  BEFORE UPDATE OF home_currency ON "organization_settings"
  FOR EACH ROW EXECUTE FUNCTION keep_home_currency();
--> statement-breakpoint
REVOKE DELETE ON "organization_settings" FROM beekeeping_app;
