-- The role that actions run as. The app connects as the database owner and
-- switches to beekeeping_app at the start of each request's transaction, so
-- row-level security applies to everything an action reads or writes.
-- Migrations keep running as the owner. This migration changes no data.

-- Roles belong to the whole server, so another database on it may have made
-- the role already.
DO $$
BEGIN
  CREATE ROLE beekeeping_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
--> statement-breakpoint
GRANT beekeeping_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO beekeeping_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beekeeping_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO beekeeping_app;
