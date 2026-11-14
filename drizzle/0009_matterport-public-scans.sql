ALTER TABLE "matterport_models" ADD COLUMN "is_public" boolean;--> statement-breakpoint
ALTER TABLE "matterport_models" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matterport_models" ADD CONSTRAINT "matterport_models_public_check_pair" CHECK (("matterport_models"."is_public" IS NULL) = ("matterport_models"."checked_at" IS NULL));