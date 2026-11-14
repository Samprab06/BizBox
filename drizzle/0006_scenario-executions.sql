ALTER TABLE "scenario_runs" ADD COLUMN "cost_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "cached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "effective_key" text;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "request" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "assembly" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "completed" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "scenario_runs_cache_idx" ON "scenario_runs" USING btree ("project_id","effective_key","status");--> statement-breakpoint
CREATE INDEX "scenario_runs_budget_idx" ON "scenario_runs" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_idempotency_unique" UNIQUE("project_id","scenario_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_cost_valid" CHECK ("scenario_runs"."cost_units" >= 0 AND (NOT "scenario_runs"."cached" OR "scenario_runs"."cost_units" = 0));--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_revision_valid" CHECK ("scenario_runs"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_lease_pair" CHECK (("scenario_runs"."lease_token" IS NULL) = ("scenario_runs"."lease_expires_at" IS NULL));