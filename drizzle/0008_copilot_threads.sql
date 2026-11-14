CREATE TABLE "copilot_thread_commits" (
	"project_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	CONSTRAINT "copilot_thread_commits_project_id_idempotency_key_pk" PRIMARY KEY("project_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "copilot_thread_events" (
	"project_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_thread_events_project_id_seq_pk" PRIMARY KEY("project_id","seq"),
	CONSTRAINT "copilot_thread_events_seq_positive" CHECK ("copilot_thread_events"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "copilot_threads" (
	"project_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"next_event_seq" integer DEFAULT 1 NOT NULL,
	"state" jsonb NOT NULL,
	"cost_microusd" bigint DEFAULT 0 NOT NULL,
	"cost_cap_microusd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_threads_revision_nonnegative" CHECK ("copilot_threads"."revision" >= 0),
	CONSTRAINT "copilot_threads_event_seq_positive" CHECK ("copilot_threads"."next_event_seq" > 0),
	CONSTRAINT "copilot_threads_cost_valid" CHECK ("copilot_threads"."cost_microusd" >= 0 AND "copilot_threads"."cost_cap_microusd" >= "copilot_threads"."cost_microusd" AND "copilot_threads"."cost_cap_microusd" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "copilot_thread_commits" ADD CONSTRAINT "copilot_thread_commits_project_id_copilot_threads_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."copilot_threads"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_thread_events" ADD CONSTRAINT "copilot_thread_events_project_id_copilot_threads_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."copilot_threads"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_threads" ADD CONSTRAINT "copilot_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;