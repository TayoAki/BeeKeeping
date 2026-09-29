-- The role the app runs as. Every connection the app opens starts as
-- beekeeping_app (openDatabase sets it when the connection opens), so
-- row-level security applies to every query the app sends, and a query can't
-- skip it by forgetting a step. The app logs in as a login role of its own,
-- a member of beekeeping_app with no rights of its own, never as the owner.
-- Migrations run as the database owner. This migration changes no data.

-- Roles belong to the whole server, and another database on it may be making
-- the same role at this moment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beekeeping_app') THEN
    BEGIN
      CREATE ROLE beekeeping_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
END
$$;
--> statement-breakpoint
-- A role made earlier by hand must not be able to log in, skip row-level
-- security or use another role's rights, such as the owner's, which
-- row-level security skips. Fail rather than run the app as such a role.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'beekeeping_app'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
           OR EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid))
  ) THEN
    RAISE EXCEPTION 'beekeeping_app can log in, bypass row-level security, create roles or databases, or use another role''s rights. A superuser must remove those before this migration can run.';
  END IF;
END
$$;
--> statement-breakpoint
-- The owner switches to the role on every app connection, so it needs the
-- right to. A superuser already has it. A role's creator can grant it to
-- itself. Anyone else needs a superuser to run the GRANT first.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'beekeeping_app', 'SET') THEN
    BEGIN
      EXECUTE format('GRANT beekeeping_app TO %I', current_user);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'The migration user % needs the right to switch to beekeeping_app. A superuser can run: GRANT beekeeping_app TO %;', current_user, current_user;
    END;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO beekeeping_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beekeeping_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO beekeeping_app;
