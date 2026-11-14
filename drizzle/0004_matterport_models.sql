CREATE TABLE "matterport_models" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"costar_property_id" text NOT NULL,
	"costar_space_id" text,
	"has_exterior" boolean,
	"source" jsonb NOT NULL,
	"display_approved" boolean DEFAULT false NOT NULL,
	"dimensions" jsonb,
	"dimensions_recorded_at" timestamp with time zone,
	CONSTRAINT "matterport_models_mapping_unique" UNIQUE NULLS NOT DISTINCT("model_id","costar_property_id","costar_space_id"),
	CONSTRAINT "matterport_models_id_valid" CHECK ("matterport_models"."id" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "matterport_models_model_valid" CHECK ("matterport_models"."model_id" ~ '^[A-Za-z0-9]{11}$'),
	CONSTRAINT "matterport_models_property_valid" CHECK ("matterport_models"."costar_property_id" ~ '^[0-9]+$'),
	CONSTRAINT "matterport_models_space_valid" CHECK ("matterport_models"."costar_space_id" IS NULL OR "matterport_models"."costar_space_id" ~ '^[0-9]+:[0-9]+$'),
	CONSTRAINT "matterport_models_dimensions_pair" CHECK (("matterport_models"."dimensions" IS NULL) = ("matterport_models"."dimensions_recorded_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "matterport_models_site_idx" ON "matterport_models" USING btree ("costar_property_id","costar_space_id");