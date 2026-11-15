CREATE TABLE "interior_jev_grants" (
	"grant_id" text PRIMARY KEY NOT NULL,
	"limit_microusd" bigint NOT NULL,
	"reserved_microusd" bigint NOT NULL,
	"handoff_receipt" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interior_jev_grant_limit" CHECK ("interior_jev_grants"."limit_microusd"=1000000),
	CONSTRAINT "interior_jev_grant_reserved" CHECK ("interior_jev_grants"."reserved_microusd">=26864 AND "interior_jev_grants"."reserved_microusd"<="interior_jev_grants"."limit_microusd"),
	CONSTRAINT "interior_jev_grant_handoff" CHECK ("interior_jev_grants"."handoff_receipt" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "interior_jev_policy_cache" (
	"project_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interior_jev_policy_cache_project_id_cache_key_pk" PRIMARY KEY("project_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE "interior_jev_policy_claims" (
	"project_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "interior_jev_policy_claims_project_id_cache_key_pk" PRIMARY KEY("project_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE "interior_jev_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"reserved_microusd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interior_jev_reservation_positive" CHECK ("interior_jev_reservations"."reserved_microusd">0)
);
--> statement-breakpoint
ALTER TABLE "interior_jev_reservations" ADD CONSTRAINT "interior_jev_reservations_grant_id_interior_jev_grants_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."interior_jev_grants"("grant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interior_jev_claims_expiry_idx" ON "interior_jev_policy_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "interior_jev_reservations_grant_idx" ON "interior_jev_reservations" USING btree ("grant_id");