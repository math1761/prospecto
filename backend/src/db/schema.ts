import { pgTable, text, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core'

export const prospectStatusEnum = pgEnum('prospect_status', [
  'new',
  'contacted',
  'replied',
  'converted',
  'rejected',
  'unsubscribed',
])

export const prospects = pgTable('prospects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  company: text('company'),
  title: text('title'),
  status: prospectStatusEnum('status').default('new').notNull(),
  campaignId: text('campaign_id').references(() => campaigns.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const emails = pgTable('emails', {
  id: text('id').primaryKey(),
  prospectId: text('prospect_id').notNull().references(() => prospects.id),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  repliedAt: timestamp('replied_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
