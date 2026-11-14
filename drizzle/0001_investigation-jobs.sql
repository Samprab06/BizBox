CREATE TABLE "investigation_milestones" (
	"investigation_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"seq" integer NOT NULL,
	"tool" text NOT NULL,
	"input_hash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_milestones_investigation_id_attempt_seq_pk" PRIMARY KEY("investigation_id","attempt","seq"),
	CONSTRAINT "investigation_milestones_attempt_positive" CHECK ("investigation_milestones"."attempt" > 0),
	CONSTRAINT "investigation_milestones_seq_nonnegative" CHECK ("investigation_milestones"."seq" >= 0)
);
--> statement-breakpoint
-- Preserve existing completed rows and enum dependencies rather than dropping
-- the enum and attempting to cast legacy completed values to an absent label.
ALTER TYPE "public"."investigation_status" RENAME VALUE 'completed' TO 'succeeded';--> statement-breakpoint
ALTER TYPE "public"."investigation_status" ADD VALUE 'interrupted';--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "limits" jsonb DEFAULT '{"toolCalls":25,"pollCustomers":3,"evaluateSites":3}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "counters" jsonb DEFAULT '{"toolCalls":0,"pollCustomers":0,"evaluateSites":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "last_advance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigation_milestones" ADD CONSTRAINT "investigation_milestones_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_attempt_positive" CHECK ("investigations"."attempt" > 0);--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_revision_nonnegative" CHECK ("investigations"."revision" >= 0);
