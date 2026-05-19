CREATE TYPE "public"."bounce_class" AS ENUM('hard', 'soft', 'transient');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounce_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"bounce_class" "bounce_class" NOT NULL,
	"smtp_code" text,
	"diagnostic_code" text,
	"sender_domain" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverability_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"overall_score" integer NOT NULL,
	"spf_status" text,
	"dkim_status" text,
	"dmarc_status" text,
	"bounce_rate" real,
	"complaint_rate" real,
	"recommendations" jsonb,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"type" text NOT NULL,
	"email_id" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "predicted_open_rate" real;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "predicted_reply_rate" real;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "predicted_conversion_rate" real;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "optimal_touch_count" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "optimal_delay_days" integer;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "in_reply_to" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "references" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "bounce_status" "bounce_class";--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "bounced_at" timestamp;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "decay_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "decay_status" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "avg_quality_score" real;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "coach_score" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounce_events" ADD CONSTRAINT "bounce_events_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounce_events" ADD CONSTRAINT "bounce_events_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_activities" ADD CONSTRAINT "prospect_activities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_activities" ADD CONSTRAINT "prospect_activities_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bounces_email_idx" ON "bounce_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "bounces_prospect_idx" ON "bounce_events" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "bounces_class_idx" ON "bounce_events" USING btree ("bounce_class");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverability_domain_idx" ON "deliverability_scores" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "activities_prospect_idx" ON "prospect_activities" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "activities_type_idx" ON "prospect_activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "activities_created_idx" ON "prospect_activities" USING btree ("created_at");