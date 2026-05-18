import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
  jsonb,
  boolean,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const prospectStatusEnum = pgEnum("prospect_status", [
  "new",
  "contacted",
  "replied",
  "converted",
  "rejected",
  "unsubscribed",
]);

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "sender",
  "viewer",
]);

export const emailChannelEnum = pgEnum("email_channel", [
  "email",
  "linkedin",
  "whatsapp",
]);

export const abVariantEnum = pgEnum("ab_variant", ["a", "b"]);

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "active",
  "paused",
  "completed",
  "stopped",
]);

export const crmProviderEnum = pgEnum("crm_provider", [
  "hubspot",
  "pipedrive",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "completed",
]);

export const replySentimentEnum = pgEnum("reply_sentiment", [
  "positive",
  "neutral",
  "negative",
  "out_of_office",
]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRoleEnum("role").default("sender").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Personas ─────────────────────────────────────────────────────────────────

export const personas = pgTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tone: text("tone").notNull(),          // e.g. "friendly", "professional", "direct"
  expertise: text("expertise").notNull(), // e.g. "B2B SaaS sales"
  writingStyle: text("writing_style").notNull(),
  signature: text("signature"),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: campaignStatusEnum("status").default("draft").notNull(),
  personaId: text("persona_id").references(() => personas.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Prospects ────────────────────────────────────────────────────────────────

export const prospects = pgTable(
  "prospects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    company: text("company"),
    title: text("title"),
    phone: text("phone"),
    linkedin: text("linkedin"),
    website: text("website"),
    location: text("location"),
    industry: text("industry"),
    companySize: text("company_size"),
    language: text("language"),           // detected or inferred
    timezone: text("timezone"),           // for smart send-time
    dealValue: integer("deal_value"),     // estimated ARR/deal value
    score: integer("score").default(0),  // lead score 0-100
    sentiment: replySentimentEnum("sentiment"),
    stackData: jsonb("stack_data").$type<string[]>(), // detected tech stack
    enrichedAt: timestamp("enriched_at"),
    // Extra columns from CSV
    extra: jsonb("extra").$type<Record<string, string>>(),
    status: prospectStatusEnum("status").default("new").notNull(),
    campaignId: text("campaign_id").references(() => campaigns.id),
    unsubscribeToken: text("unsubscribe_token").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("prospects_email_idx").on(t.email),
    index("prospects_campaign_idx").on(t.campaignId),
    index("prospects_status_idx").on(t.status),
  ],
);

// ─── Templates ────────────────────────────────────────────────────────────────

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subjectPrompt: text("subject_prompt").notNull(),
  bodyPrompt: text("body_prompt").notNull(),
  version: text("version").default("1.0.0").notNull(), // semver
  parentId: text("parent_id"),                          // previous version
  isDefault: boolean("is_default").default(false).notNull(),
  openRate: real("open_rate"),
  replyRate: real("reply_rate"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Emails ───────────────────────────────────────────────────────────────────

export const emails = pgTable(
  "emails",
  {
    id: text("id").primaryKey(),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id),
    templateId: text("template_id").references(() => templates.id),
    sequenceStepId: text("sequence_step_id"), // fk set after sequences table defined
    abTestId: text("ab_test_id"),
    abVariant: abVariantEnum("ab_variant"),
    channel: emailChannelEnum("channel").default("email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    qualityScore: integer("quality_score"),
    spamScore: integer("spam_score"),
    trackingId: text("tracking_id").unique(),
    sentAt: timestamp("sent_at"),
    scheduledAt: timestamp("scheduled_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    repliedAt: timestamp("replied_at"),
    replyBody: text("reply_body"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("emails_prospect_idx").on(t.prospectId),
    index("emails_campaign_idx").on(t.campaignId),
    index("emails_tracking_idx").on(t.trackingId),
  ],
);

// ─── Sequences ────────────────────────────────────────────────────────────────

export const sequences = pgTable("sequences", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: text("id").primaryKey(),
  sequenceId: text("sequence_id")
    .notNull()
    .references(() => sequences.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  delayDays: integer("delay_days").default(0).notNull(),
  templateId: text("template_id").references(() => templates.id),
  subjectOverride: text("subject_override"),
  bodyOverride: text("body_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sequenceEnrollments = pgTable(
  "sequence_enrollments",
  {
    id: text("id").primaryKey(),
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    currentStep: integer("current_step").default(1).notNull(),
    status: enrollmentStatusEnum("status").default("active").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    nextStepAt: timestamp("next_step_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("enrollments_unique").on(t.sequenceId, t.prospectId),
  ],
);

// ─── A/B Tests ────────────────────────────────────────────────────────────────

export const abTests = pgTable("ab_tests", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  name: text("name").notNull(),
  templateAId: text("template_a_id").references(() => templates.id),
  templateBId: text("template_b_id").references(() => templates.id),
  splitRatio: real("split_ratio").default(0.5).notNull(), // 0.5 = 50/50
  winnerVariant: abVariantEnum("winner_variant"),
  status: text("status").default("running").notNull(), // running | completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ─── Send Schedules ───────────────────────────────────────────────────────────

export const sendSchedules = pgTable("send_schedules", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  dailyLimit: integer("daily_limit").default(50).notNull(),
  sendWindowStart: text("send_window_start").default("09:00").notNull(), // HH:MM
  sendWindowEnd: text("send_window_end").default("17:00").notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Warmup Configs ───────────────────────────────────────────────────────────

export const warmupConfigs = pgTable("warmup_configs", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  currentDailyLimit: integer("current_daily_limit").default(5).notNull(),
  targetDailyLimit: integer("target_daily_limit").default(200).notNull(),
  incrementPerDay: integer("increment_per_day").default(5).notNull(),
  lastIncrementAt: timestamp("last_increment_at"),
  isActive: boolean("is_active").default(true).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
});

// ─── Webhook Configs (n8n outbound) ───────────────────────────────────────────

export const webhookConfigs = pgTable("webhook_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret"),
  events: jsonb("events")
    .$type<string[]>()
    .default(["prospect.status_changed"])
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastTriggeredAt: timestamp("last_triggered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Import History ───────────────────────────────────────────────────────────

export const importHistory = pgTable("import_history", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  successCount: integer("success_count").notNull(),
  duplicateCount: integer("duplicate_count").notNull(),
  skippedCount: integer("skipped_count").default(0).notNull(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    userId: text("user_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entity, t.entityId),
  ],
);

// ─── CRM Integrations ─────────────────────────────────────────────────────────

export const crmIntegrations = pgTable("crm_integrations", {
  id: text("id").primaryKey(),
  provider: crmProviderEnum("provider").notNull(),
  apiKey: text("api_key").notNull(),
  portalId: text("portal_id"),      // HubSpot portal ID
  pipelineId: text("pipeline_id"),  // Pipedrive pipeline
  isActive: boolean("is_active").default(true).notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Sessions (better-auth) ────────────────────────────────────────────────────

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Accounts (better-auth) ───────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Verifications (better-auth) ──────────────────────────────────────────────

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const campaignRelations = relations(campaigns, ({ many, one }) => ({
  prospects: many(prospects),
  emails: many(emails),
  sequences: many(sequences),
  persona: one(personas, { fields: [campaigns.personaId], references: [personas.id] }),
}));

export const prospectRelations = relations(prospects, ({ many, one }) => ({
  emails: many(emails),
  enrollments: many(sequenceEnrollments),
  campaign: one(campaigns, { fields: [prospects.campaignId], references: [campaigns.id] }),
}));

export const emailRelations = relations(emails, ({ one }) => ({
  prospect: one(prospects, { fields: [emails.prospectId], references: [prospects.id] }),
  campaign: one(campaigns, { fields: [emails.campaignId], references: [campaigns.id] }),
  template: one(templates, { fields: [emails.templateId], references: [templates.id] }),
}));

export const sequenceRelations = relations(sequences, ({ many }) => ({
  steps: many(sequenceSteps),
  enrollments: many(sequenceEnrollments),
}));
