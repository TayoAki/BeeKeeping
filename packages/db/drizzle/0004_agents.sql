-- Agents and API tokens. An agent is a principal of one organization, with
-- a role (admin, bookkeeper or viewer, never owner) and a scope (read,
-- draft or post), and a token lets a headless agent act as its agent. Only
-- a token's SHA-256 is stored, and the app can't read even that. Both
-- tables have org_id, row-level security and an audit trigger, and a second
-- policy hides both from the app while an agent acts, so agents never make,
-- read or revoke agents or tokens. Neither loses a row: the app may only
-- set revoked_at, and a revoked row never changes again.
--
-- The audit log gains the agent (app.agent_id) and the person who approved
-- an agent's change (app.approver_id), which runAction sets beside
-- app.user_id. Both columns default to those settings, so audit_row()
-- fills them as migration 0003 wrote it.
--
-- Two functions run as the owner, past row-level security, and only the
-- app may call them. authenticate_api_token(hash) is the one lookup that
-- runs before an organization is known. It answers only for the hash it's
-- given: the token's organization, agent, role and scope, or nothing when
-- the token or its agent is revoked or the token has expired.
-- working_agent() answers the role and scope of the agent a transaction
-- acts for, while it works, so the registry checks the agent on every
-- call. This migration changes no data.

-- The agent and the approver a transaction acts for, as runAction sets
-- them with set local. Unset, they are null. The audit log's new columns
-- default to them, so they come first.
CREATE FUNCTION current_agent_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT nullif(current_setting('app.agent_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION current_approver_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT nullif(current_setting('app.approver_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agents_org_id_id" UNIQUE("org_id","id"),
	CONSTRAINT "agents_name_check" CHECK (char_length(btrim("agents"."name")) between 1 and 80),
	CONSTRAINT "agents_role_check" CHECK ("agents"."role" in ('admin', 'bookkeeper', 'viewer')),
	CONSTRAINT "agents_scope_check" CHECK ("agents"."scope" in ('read', 'draft', 'post'))
);
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_hash_check" CHECK ("api_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_tokens_prefix_check" CHECK ("api_tokens"."prefix" ~ '^bk_[A-Za-z0-9_-]{7}$'),
	CONSTRAINT "api_tokens_expiry_check" CHECK ("api_tokens"."expires_at" is null or "api_tokens"."expires_at" > "api_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_agent_id" uuid DEFAULT current_agent_id();--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "approved_by_user_id" uuid DEFAULT current_approver_id();--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_agent_fk" FOREIGN KEY ("org_id","agent_id") REFERENCES "public"."agents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_org_name" ON "agents" USING btree ("org_id",lower("name")) WHERE "agents"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "api_tokens_agent" ON "api_tokens" USING btree ("org_id","agent_id");--> statement-breakpoint
CREATE POLICY "agents_org_isolation" ON "agents" AS PERMISSIVE FOR ALL TO "beekeeping_app" USING ("agents"."org_id" = (select current_org_id())) WITH CHECK ("agents"."org_id" = (select current_org_id()));--> statement-breakpoint
CREATE POLICY "agents_people_only" ON "agents" AS RESTRICTIVE FOR ALL TO "beekeeping_app" USING ((select current_agent_id()) is null) WITH CHECK ((select current_agent_id()) is null);--> statement-breakpoint
CREATE POLICY "api_tokens_org_isolation" ON "api_tokens" AS PERMISSIVE FOR ALL TO "beekeeping_app" USING ("api_tokens"."org_id" = (select current_org_id())) WITH CHECK ("api_tokens"."org_id" = (select current_org_id()));--> statement-breakpoint
CREATE POLICY "api_tokens_people_only" ON "api_tokens" AS RESTRICTIVE FOR ALL TO "beekeeping_app" USING ((select current_agent_id()) is null) WITH CHECK ((select current_agent_id()) is null);
--> statement-breakpoint
-- Revoked, never deleted, and otherwise fixed once made: the app may only
-- set revoked_at. Migration 0000's default privileges gave it the rest. It
-- reads every field of a token but the hash, which only
-- authenticate_api_token compares.
REVOKE UPDATE, DELETE ON "agents", "api_tokens" FROM beekeeping_app;
--> statement-breakpoint
GRANT UPDATE ("revoked_at") ON "agents", "api_tokens" TO beekeeping_app;
--> statement-breakpoint
REVOKE SELECT ON "api_tokens" FROM beekeeping_app;
--> statement-breakpoint
GRANT SELECT ("id", "org_id", "agent_id", "prefix", "created_at", "expires_at", "last_used_at", "revoked_at") ON "api_tokens" TO beekeeping_app;
--> statement-breakpoint
CREATE FUNCTION keep_revoked() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'A revoked row in % never changes.', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER agents_keep_revoked
  BEFORE UPDATE ON "agents"
  FOR EACH ROW EXECUTE FUNCTION keep_revoked();
--> statement-breakpoint
CREATE TRIGGER api_tokens_keep_revoked
  BEFORE UPDATE ON "api_tokens"
  FOR EACH ROW EXECUTE FUNCTION keep_revoked();
--> statement-breakpoint
-- What the log may copy. Never a token's hash, and never last_used_at, so a
-- token's use leaves no event of its own.
CREATE TRIGGER agents_audit
  AFTER INSERT OR UPDATE OR DELETE ON "agents"
  FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'name', 'role', 'scope', 'revoked_at');
--> statement-breakpoint
CREATE TRIGGER api_tokens_audit
  AFTER INSERT OR UPDATE OR DELETE ON "api_tokens"
  FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'agent_id', 'prefix', 'expires_at', 'revoked_at');
--> statement-breakpoint
-- The token's organization, agent, role and scope, or no row. It notes the
-- token's use at most once a minute, so a busy agent doesn't write on
-- every call. The update checks the row as it stands when it writes, so it
-- leaves alone a token revoked a moment ago, or one another call noted.
CREATE FUNCTION authenticate_api_token(presented_hash text)
  RETURNS TABLE (org_id uuid, agent_id uuid, role text, scope text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  WITH valid AS (
    SELECT t.id, t.org_id, t.agent_id, a.role, a.scope
      FROM public.api_tokens t
      JOIN public.agents a ON a.org_id = t.org_id AND a.id = t.agent_id
     WHERE t.token_hash = presented_hash
       AND t.revoked_at IS NULL
       AND a.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now())
  ), used AS (
    UPDATE public.api_tokens t
       SET last_used_at = now()
      FROM valid
     WHERE t.id = valid.id
       AND t.revoked_at IS NULL
       AND (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute')
  )
  SELECT valid.org_id, valid.agent_id, valid.role, valid.scope FROM valid
$$;
--> statement-breakpoint
-- The role and scope of the agent the transaction acts for, while it
-- works: no row once the agent is revoked, for an agent this organization
-- never had, or when no agent acts. The share lock lasts until the call
-- commits, so revoke_agent waits for the calls already running, and none
-- of them lands after the revoke.
CREATE FUNCTION working_agent()
  RETURNS TABLE (role text, scope text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT a.role, a.scope
    FROM public.agents a
   WHERE a.org_id = public.current_org_id()
     AND a.id = public.current_agent_id()
     AND a.revoked_at IS NULL
     FOR SHARE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION authenticate_api_token(text), working_agent() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION authenticate_api_token(text), working_agent() TO beekeeping_app;
