-- The audit log. A trigger on each table that holds an organization's data
-- copies the fields that table lists into audit_events: an insert's values,
-- an update's changed fields as [old, new], a delete's old values. A field
-- the table doesn't list, such as a credential, never enters the log. The
-- person comes from app.user_id, which runAction sets, and the organization
-- from the row itself. seq numbers the events in the order they were
-- written, since the events of one transaction share occurred_at.
--
-- The app reads its own organization's events through the policy below,
-- and can't write, change or remove any. Only the trigger function writes,
-- as the owner. A trigger refuses UPDATE, DELETE and TRUNCATE for every
-- role, the owner's included. The owner, which migrations and test setup
-- log in as, can still add a row directly or turn that trigger off; the
-- app never logs in as the owner.
--
-- A new table with org_id gets a trigger in its own migration, naming its
-- key and the fields to copy:
--   CREATE TRIGGER <table>_audit AFTER INSERT OR UPDATE OR DELETE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION audit_row('<key column>', '<field>', ...);
-- packages/db/src/audit.test.ts fails for a table with org_id and no such
-- trigger. This migration changes no data.

CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "audit_events_action_check" CHECK ("audit_events"."action" in ('insert', 'update', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_events_org_time" ON "audit_events" USING btree ("org_id","occurred_at","seq");--> statement-breakpoint
CREATE INDEX "audit_events_org_table" ON "audit_events" USING btree ("org_id","table_name");--> statement-breakpoint
CREATE POLICY "audit_events_org_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO "beekeeping_app" USING ("audit_events"."org_id" = (select current_org_id())) WITH CHECK ("audit_events"."org_id" = (select current_org_id()));

--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "audit_events" FROM beekeeping_app;
--> statement-breakpoint
-- Migration 0000's default privileges gave the app every new sequence.
REVOKE ALL ON SEQUENCE "audit_events_seq_seq" FROM beekeeping_app;
--> statement-breakpoint
-- The first argument names the row's key column, and the rest the fields
-- to copy. It runs as the owner, who writes the log past row-level
-- security, so it names every schema and sets its own search path. A
-- trigger attached the wrong way fails loudly rather than logging wrongly.
CREATE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  changes jsonb := '{}'::jsonb;
  field text;
BEGIN
  -- Run BEFORE, it would drop the write it logs, since it returns NULL.
  IF TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'The audit trigger on % must run AFTER, FOR EACH ROW.', TG_TABLE_NAME;
  END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  row_data := coalesce(new_row, old_row);
  IF NOT row_data ? 'org_id' THEN
    RAISE EXCEPTION 'The audit trigger on % needs a table with org_id.', TG_TABLE_NAME;
  END IF;
  IF TG_NARGS < 1 OR NOT row_data ? TG_ARGV[0] THEN
    RAISE EXCEPTION 'The audit trigger on % needs the table''s key column first.', TG_TABLE_NAME;
  END IF;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    field := TG_ARGV[i];
    IF NOT row_data ? field THEN
      RAISE EXCEPTION 'The audit trigger on % lists %, which it doesn''t have.', TG_TABLE_NAME, field;
    END IF;
    IF TG_OP = 'INSERT' THEN
      changes := changes || jsonb_build_object(field, new_row -> field);
    ELSIF TG_OP = 'DELETE' THEN
      changes := changes || jsonb_build_object(field, old_row -> field);
    ELSIF (old_row -> field) IS DISTINCT FROM (new_row -> field) THEN
      changes := changes || jsonb_build_object(field, jsonb_build_array(old_row -> field, new_row -> field));
    END IF;
  END LOOP;
  -- An update that changed only fields the table doesn't list leaves
  -- nothing, not even the fact that it happened.
  IF TG_OP = 'UPDATE' AND changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_events (org_id, actor_user_id, table_name, record_id, action, changes)
  VALUES (
    (row_data ->> 'org_id')::uuid,
    public.current_user_id(),
    TG_TABLE_NAME,
    row_data ->> TG_ARGV[0],
    lower(TG_OP),
    changes
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_row() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION keep_audit_events() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION 'The audit log never changes.'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_keep
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION keep_audit_events();
--> statement-breakpoint
CREATE TRIGGER audit_events_keep_all
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION keep_audit_events();
--> statement-breakpoint
-- The home currency, the only field an organization's settings hold today.
CREATE TRIGGER organization_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON "organization_settings"
  FOR EACH ROW EXECUTE FUNCTION audit_row('org_id', 'home_currency');
