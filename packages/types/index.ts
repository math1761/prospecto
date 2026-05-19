// ─── AI Service Prospect (subset of DB schema for prompts) ─────────────────────

export type AIProspect = {
  id?: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  website?: string;
  location?: string;
  industry?: string;
  companySize?: string;
  language?: string;
  timezone?: string;
  stackData?: string[];
  extra?: Record<string, string>;
};

// ─── AI Persona ──────────────────────────────────────────────────────────────

export type AIPersona = {
  tone: string;
  expertise: string;
  writingStyle: string;
  signature?: string;
};

// ─── Mailer send payload (API → Mailer contract) ────────────────────────────

export type SendPayload = {
  to: string;
  name: string;
  subject: string;
  body: string;
  trackingId?: string;
  unsubscribeUrl?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
};

// ─── Queue job types ─────────────────────────────────────────────────────────

export type GenerateJob = {
  prospectId: string;
  templateId?: string;
  personaId?: string;
  campaignId?: string;
};

export type SendJob = {
  emailId: string;
};

export type RetryBounceJob = {
  emailId: string;
  bounceEventId: string;
};
