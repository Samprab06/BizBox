CREATE TYPE "public"."scenario_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "project_active_scenario" (
	"project_id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"comparison_id" text,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "scenario_run_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"site_ids" jsonb NOT NULL,
	"profile_version" integer NOT NULL,
	"overrides" jsonb NOT NULL,
	"layout_id" text,
	"label" text NOT NULL,
	"author" text NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenarios_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "scenarios_author_valid" CHECK ("scenarios"."author" in ('founder', 'agent')),
	CONSTRAINT "scenarios_agent_rationale" CHECK ("scenarios"."author" <> 'agent' or ("scenarios"."rationale" is not null and btrim("scenarios"."rationale") <> '')),
	CONSTRAINT "scenarios_agent_never_founder" CHECK ("scenarios"."author" <> 'agent' or not jsonb_path_exists("scenarios"."overrides", '$.**.origin ? (@ == "founder")')),
	CONSTRAINT "scenarios_site_ids_valid" CHECK (jsonb_typeof("scenarios"."site_ids") = 'array' and jsonb_array_length("scenarios"."site_ids") between 1 and 8),
	CONSTRAINT "scenarios_not_own_parent" CHECK ("scenarios"."parent_id" is distinct from "scenarios"."id"),
	CONSTRAINT "scenarios_profile_version_positive" CHECK ("scenarios"."profile_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "project_active_scenario" ADD CONSTRAINT "project_active_scenario_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_active_scenario" ADD CONSTRAINT "project_active_scenario_scoped_scenario_fk" FOREIGN KEY ("project_id","scenario_id") REFERENCES "public"."scenarios"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_scoped_scenario_fk" FOREIGN KEY ("project_id","scenario_id") REFERENCES "public"."scenarios"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_scoped_comparison_fk" FOREIGN KEY ("project_id","comparison_id") REFERENCES "public"."comparisons"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_scoped_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."scenarios"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_scoped_profile_version_fk" FOREIGN KEY ("project_id","profile_version") REFERENCES "public"."profiles"("project_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenario_runs_scenario_idx" ON "scenario_runs" USING btree ("project_id","scenario_id");--> statement-breakpoint
CREATE INDEX "scenario_runs_comparison_idx" ON "scenario_runs" USING btree ("project_id","comparison_id");--> statement-breakpoint
CREATE INDEX "scenarios_project_idx" ON "scenarios" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scenarios_parent_idx" ON "scenarios" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE FUNCTION "scenarios_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'scenarios are immutable: insert a new version with parent_id instead of updating %', OLD.id
		USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scenarios_immutable" BEFORE UPDATE ON "scenarios" FOR EACH ROW EXECUTE FUNCTION "scenarios_reject_update"();
