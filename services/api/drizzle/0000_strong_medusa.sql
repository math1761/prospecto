CREATE TYPE "public"."ab_variant" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."crm_provider" AS ENUM('hubspot', 'pipedrive');--> statement-breakpoint
CREATE TYPE "public"."email_channel" AS ENUM('email', 'linkedin', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'paused', 'completed', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('new', 'contacted', 'replied', 'converted', 'rejected', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."reply_sentiment" AS ENUM('positive', 'neutral', 'negative', 'out_of_office');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'sender', 'viewer');--> statement-breakpoint
CREATE TABLE "ab_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"name" text NOT NULL,
	"template_a_id" text,
	"template_b_id" text,
	"split_ratio" real DEFAULT 0.5 NOT NULL,
	"winner_variant" "ab_variant",
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"user_id" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"persona_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "crm_provider" NOT NULL,
	"api_key" text NOT NULL,
	"portal_id" text,
	"pipeline_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"campaign_id" text,
	"template_id" text,
	"sequence_step_id" text,
	"ab_test_id" text,
	"ab_variant" "ab_variant",
	"channel" "email_channel" DEFAULT 'email' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"quality_score" integer,
	"spam_score" integer,
	"tracking_id" text,
	"sent_at" timestamp,
	"scheduled_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"replied_at" timestamp,
	"reply_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "emails_tracking_id_unique" UNIQUE("tracking_id")
);
--> statement-breakpoint
CREATE TABLE "import_history" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL,
	"success_count" integer NOT NULL,
	"duplicate_count" integer NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"campaign_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tone" text NOT NULL,
	"expertise" text NOT NULL,
	"writing_style" text NOT NULL,
	"signature" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"title" text,
	"phone" text,
	"linkedin" text,
	"website" text,
	"location" text,
	"industry" text,
	"company_size" text,
	"language" text,
	"timezone" text,
	"deal_value" integer,
	"score" integer DEFAULT 0,
	"sentiment" "reply_sentiment",
	"stack_data" jsonb,
	"enriched_at" timestamp,
	"extra" jsonb,
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"campaign_id" text,
	"unsubscribe_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_email_unique" UNIQUE("email"),
	CONSTRAINT "prospects_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "send_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"send_window_start" text DEFAULT '09:00' NOT NULL,
	"send_window_end" text DEFAULT '17:00' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"next_step_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"template_id" text,
	"subject_override" text,
	"body_override" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"campaign_id" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject_prompt" text NOT NULL,
	"body_prompt" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"parent_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"open_rate" real,
	"reply_rate" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'sender' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "warmup_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"current_daily_limit" integer DEFAULT 5 NOT NULL,
	"target_daily_limit" integer DEFAULT 200 NOT NULL,
	"increment_per_day" integer DEFAULT 5 NOT NULL,
	"last_increment_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warmup_configs_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" jsonb DEFAULT '["prospect.status_changed"]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_template_a_id_templates_id_fk" FOREIGN KEY ("template_a_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_template_b_id_templates_id_fk" FOREIGN KEY ("template_b_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_history" ADD CONSTRAINT "import_history_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_schedules" ADD CONSTRAINT "send_schedules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "emails_prospect_idx" ON "emails" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "emails_campaign_idx" ON "emails" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "emails_tracking_idx" ON "emails" USING btree ("tracking_id");--> statement-breakpoint
CREATE INDEX "prospects_email_idx" ON "prospects" USING btree ("email");--> statement-breakpoint
CREATE INDEX "prospects_campaign_idx" ON "prospects" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "prospects_status_idx" ON "prospects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_unique" ON "sequence_enrollments" USING btree ("sequence_id","prospect_id");