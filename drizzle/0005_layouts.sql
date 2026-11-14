CREATE TABLE "layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"parent_id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layouts_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "layouts_project_site_id_unique" UNIQUE("project_id","site_id","id"),
	CONSTRAINT "layouts_not_own_parent" CHECK ("layouts"."parent_id" is distinct from "layouts"."id"),
	CONSTRAINT "layouts_identity_valid" CHECK (length(btrim("layouts"."id")) between 1 and 200 and length(btrim("layouts"."site_id")) between 1 and 200),
	CONSTRAINT "layouts_data_identity" CHECK (jsonb_typeof("layouts"."data") = 'object' and "layouts"."data" ?& array['layoutId', 'siteId', 'parentId'] and ("layouts"."data"->>'layoutId') is not distinct from "layouts"."id" and ("layouts"."data"->>'siteId') is not distinct from "layouts"."site_id" and ("layouts"."data"->>'parentId') is not distinct from "layouts"."parent_id")
);
--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_scoped_parent_fk" FOREIGN KEY ("project_id","site_id","parent_id") REFERENCES "public"."layouts"("project_id","site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layouts_parent_idx" ON "layouts" USING btree ("project_id","site_id","parent_id");--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_scoped_layout_fk" FOREIGN KEY ("project_id","layout_id") REFERENCES "public"."layouts"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenarios_layout_idx" ON "scenarios" USING btree ("project_id","layout_id");
--> statement-breakpoint
CREATE FUNCTION "layouts_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'layouts are immutable: insert a new version with parent_id instead of updating %', OLD.id
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "layouts_immutable" BEFORE UPDATE ON "layouts" FOR EACH ROW EXECUTE FUNCTION "layouts_reject_update"();
