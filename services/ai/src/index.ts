import { Hono } from "hono";
import type { AIProspect, AIPersona } from "@prospecto/types";

type Env = {
  AI: Ai;
  AI_CACHE: KVNamespace;
};

type Prospect = AIProspect;
type Persona = AIPersona;

const DEFAULT_MODEL = "@cf/openai/gpt-oss-120b";

// TTLs per endpoint category
const TTL_SHORT = 3600;    // 1h  — email quality scores
const TTL_MEDIUM = 86400;  // 24h — prospect scores
const TTL_LONG = 604800;   // 7d  — enrichment, sentiment, stack detection

const app = new Hono<{ Bindings: Env }>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function kvKey(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractJson(text: string): unknown {
  const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean); } catch {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  // Truncated JSON recovery — close open strings and braces
  let recovered = clean;
  const openQuotes = (recovered.match(/(?<!\\)"/g) ?? []).length;
  if (openQuotes % 2 !== 0) recovered += '"';
  const openBraces = (recovered.match(/{/g) ?? []).length;
  const closeBraces = (recovered.match(/}/g) ?? []).length;
  recovered += "}".repeat(Math.max(0, openBraces - closeBraces));
  try { return JSON.parse(recovered); } catch {}
  throw new Error(`JSON parse failed: ${clean.slice(0, 200)}`);
}

async function chat(
  env: Env,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { json?: boolean; maxTokens?: number; ttl?: number } = {},
): Promise<any> {
  const cacheEnabled = options.ttl !== undefined && options.ttl > 0;
  const ck = cacheEnabled ? await kvKey(JSON.stringify(messages)) : null;

  if (ck) {
    const hit = await env.AI_CACHE.get(ck);
    if (hit) return JSON.parse(hit);
  }

  const result = await (env.AI.run as any)(DEFAULT_MODEL, {
    messages,
    max_tokens: options.maxTokens ?? 600,
  }) as { response?: string };

  const content = result.response ?? "";
  const value = options.json ? extractJson(content) : content;

  if (ck) {
    await env.AI_CACHE.put(ck, JSON.stringify(value), { expirationTtl: options.ttl });
  }

  return value;
}

function buildProspectContext(prospect: Prospect): string {
  return [
    `Name: ${prospect.name}`,
    prospect.company && `Company: ${prospect.company}`,
    prospect.title && `Title: ${prospect.title}`,
    prospect.website && `Website: ${prospect.website}`,
    prospect.location && `Location: ${prospect.location}`,
    prospect.industry && `Industry: ${prospect.industry}`,
    prospect.companySize && `Company size: ${prospect.companySize}`,
    prospect.stackData?.length && `Tech stack: ${prospect.stackData.join(", ")}`,
    prospect.extra &&
      Object.entries(prospect.extra)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPersonaInstructions(persona?: Persona): string {
  if (!persona) return "";
  return `\nSender persona:
- Tone: ${persona.tone}
- Expertise: ${persona.expertise}
- Writing style: ${persona.writingStyle}
${persona.signature ? `- Sign off with: ${persona.signature}` : ""}`;
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "ai", model: DEFAULT_MODEL }));

// ─── Generate email ───────────────────────────────────────────────────────────

app.post("/generate", async (c) => {
  const { prospect, templateId, persona, subjectOverride, bodyOverride, siteContext } =
    await c.req.json<{
      prospect: Prospect;
      templateId?: string;
      persona?: Persona;
      subjectOverride?: string;
      bodyOverride?: string;
      siteContext?: string;
    }>();

  const contextLines = buildProspectContext(prospect);
  const personaInstructions = buildPersonaInstructions(persona);
  const langInstruction =
    prospect.language && prospect.language !== "en"
      ? `\nIMPORTANT: Write the email in ${prospect.language}.`
      : "";
  const siteSection = siteContext ? `\nCompany website context:\n${siteContext}` : "";

  const system = `You are an expert B2B sales copywriter writing cold outreach emails.
Rules:
- Subject line: short, curiosity-driven, no spam trigger words
- Body: 3-4 short paragraphs, under 150 words
- Reference specific prospect details to show genuine research
- One clear call to action (15-minute call)
- Never sound robotic or template-like${personaInstructions}${langInstruction}
Respond with valid JSON only: { "subject": "...", "body": "..." }`;

  const user = `Write a cold outreach email for this prospect:\n${contextLines}${siteSection}`;

  try {
    // No cache — each email should be unique
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 1024 });

    return c.json({ subject: result.subject, body: result.body });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Follow-up (thread-aware) ─────────────────────────────────────────────────

app.post("/follow-up", async (c) => {
  const { prospect, threadContext, persona } = await c.req.json<{
    prospect: Prospect;
    threadContext: string;
    persona?: Persona;
  }>();

  const personaInstructions = buildPersonaInstructions(persona);

  const system = `You are an expert B2B sales copywriter writing follow-up emails.
You have been given the existing email thread. Write a contextually aware follow-up that:
- Acknowledges the prior exchange without being repetitive
- Adds new value or angle
- Is brief (under 100 words)
- Has a soft, low-friction call to action${personaInstructions}
Respond with JSON: { "subject": "...", "body": "..." }`;

  const user = `Prospect: ${buildProspectContext(prospect)}\n\nPrior thread:\n${threadContext}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 400 });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Objection handler ────────────────────────────────────────────────────────

app.post("/objection", async (c) => {
  const { originalEmail, replyBody, prospect } = await c.req.json<{
    originalEmail: { subject: string; body: string };
    replyBody: string;
    prospect: Prospect;
  }>();

  const system = `You are an expert B2B sales coach. The prospect replied with an objection or rejection.
Write a short, graceful response that:
- Acknowledges their concern without being pushy
- Provides a brief, specific rebuttal or alternative value prop
- Leaves the door open without pressure
- Is under 80 words
Respond with JSON: { "subject": "...", "body": "..." }`;

  const user = `Original email subject: ${originalEmail.subject}
Prospect: ${buildProspectContext(prospect)}
Their reply: "${replyBody}"`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 300 });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Multi-channel variants ───────────────────────────────────────────────────

app.post("/variants", async (c) => {
  const { subject, body, prospect } = await c.req.json<{
    subject: string;
    body: string;
    prospect: Prospect;
  }>();

  const system = `You are an expert multi-channel sales copywriter.
Given a cold email, produce adapted versions for LinkedIn DM and WhatsApp.
Rules:
- LinkedIn DM: professional, under 100 words, no subject
- WhatsApp: conversational, under 60 words, no subject, use first name only
Respond with JSON: { "linkedin": "...", "whatsapp": "..." }`;

  const user = `Original email:\nSubject: ${subject}\n\n${body}\n\nProspect: ${prospect.name} at ${prospect.company ?? "unknown"}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 400 });

    return c.json({ email: { subject, body }, linkedin: result.linkedin, whatsapp: result.whatsapp });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Email quality score ──────────────────────────────────────────────────────

app.post("/score", async (c) => {
  const { subject, body, prospect } = await c.req.json<{
    subject: string;
    body: string;
    prospect: Prospect;
  }>();

  const system = `Rate this cold email 0–100 across four dimensions:
- Personalisation (30 pts): does it reference specific prospect details?
- Clarity (25 pts): clear value prop and ask?
- Call to action (25 pts): specific, low-friction CTA?
- Tone (20 pts): natural, not robotic or salesy?
Respond with JSON: { "score": number, "breakdown": { "personalisation": n, "clarity": n, "cta": n, "tone": n }, "feedback": "one sentence" }`;

  const user = `Prospect: ${prospect.name} at ${prospect.company ?? "unknown company"}
Subject: ${subject}
Body: ${body}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 200, ttl: TTL_SHORT });

    return c.json(result);
  } catch (e) {
    return c.json({ score: 0, feedback: "Could not score email", breakdown: {} }, 502);
  }
});

// ─── Reply sentiment classification ───────────────────────────────────────────

app.post("/sentiment", async (c) => {
  const { text } = await c.req.json<{ text: string }>();

  const system = `Classify the sentiment of this email reply into exactly one of:
- positive (interested, wants to connect, asked questions)
- neutral (non-committal, needs more info, maybe later)
- negative (not interested, unsubscribe, firm rejection)
- out_of_office (auto-reply, OOO message)
Respond with JSON: { "sentiment": "positive|neutral|negative|out_of_office", "confidence": 0-1 }`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: text },
    ], { json: true, maxTokens: 60, ttl: TTL_LONG });

    return c.json(result);
  } catch (e) {
    return c.json({ sentiment: "neutral", confidence: 0 }, 502);
  }
});

// ─── Prospect lead scoring ────────────────────────────────────────────────────

app.post("/score-prospect", async (c) => {
  const { prospect } = await c.req.json<{ prospect: Prospect }>();

  const system = `You are a B2B sales qualifier. Score this prospect 0–100 for outreach priority.
Scoring criteria:
- Job title seniority (decision-maker = high, junior = low): 35 pts
- Company size indicator: 25 pts
- Industry fit (tech/SaaS = high, unrelated = low): 25 pts
- Data completeness (more known = more confident): 15 pts
Respond with JSON: { "score": number, "reasoning": "two sentences max" }`;

  const user = buildProspectContext(prospect);

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 150, ttl: TTL_MEDIUM });

    return c.json(result);
  } catch (e) {
    return c.json({ score: 50, reasoning: "Could not score prospect" }, 502);
  }
});

// ─── Website enrichment scraper ───────────────────────────────────────────────

app.post("/enrich-website", async (c) => {
  const { url, company } = await c.req.json<{ url?: string; company?: string }>();

  let pageText = "";

  if (url) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Prospecto/1.0 (enrichment bot)" },
        signal: AbortSignal.timeout(5000),
      });
      const html = await res.text();
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
    } catch {
      pageText = `Could not fetch ${url}`;
    }
  }

  const system = `You are a prospect enrichment assistant. Extract structured information from company website text.
Respond with JSON:
{
  "industry": "string or null",
  "companySize": "1-10|11-50|51-200|201-500|500+|null",
  "summary": "2-sentence company description",
  "intentSignals": ["array of notable recent signals: funding, hiring, product launch, etc."]
}`;

  const user = url
    ? `Company: ${company ?? url}\nWebsite content:\n${pageText}`
    : `Company name: ${company}. Infer what you can.`;

  try {
    // Long TTL — website content rarely changes day-to-day
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 300, ttl: TTL_LONG });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Smart send-time prediction ───────────────────────────────────────────────

app.post("/send-time", async (c) => {
  const { timezone, industry, location } = await c.req.json<{
    timezone?: string;
    industry?: string;
    location?: string;
  }>();

  const system = `You are an email deliverability expert. Recommend the optimal time to send a cold B2B email.
Use industry open-rate benchmarks and timezone. Avoid Mondays before 10am, Fridays after 3pm, and weekends.
Respond with JSON: { "recommendedTime": "ISO 8601 UTC datetime for next occurrence", "localTime": "HH:MM in prospect timezone", "reasoning": "one sentence" }`;

  const user = `Timezone: ${timezone ?? "UTC"}
Industry: ${industry ?? "unknown"}
Location: ${location ?? "unknown"}
Current UTC time: ${new Date().toISOString()}`;

  try {
    // No cache — time-dependent
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 150 });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Competitor detection ─────────────────────────────────────────────────────

app.post("/competitor-detect", async (c) => {
  const { websiteText, company } = await c.req.json<{
    websiteText?: string;
    company?: string;
  }>();

  const system = `Analyse the company context and identify tools/software they likely use.
Focus on: CRM, marketing automation, email, analytics, project management, infrastructure.
Respond with JSON: { "detectedStack": ["tool1", "tool2"], "confidence": "high|medium|low", "pitchAngle": "one sentence on how to position against their stack" }`;

  const user = websiteText
    ? `Company: ${company ?? "unknown"}\nContext:\n${websiteText.slice(0, 2000)}`
    : `Company: ${company ?? "unknown"}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 200, ttl: TTL_LONG });

    return c.json(result);
  } catch (e) {
    return c.json({ detectedStack: [], confidence: "low", pitchAngle: "" }, 502);
  }
});

// ─── A/B subject variant generation ──────────────────────────────────────────

app.post("/ab-subjects", async (c) => {
  const { body, prospect } = await c.req.json<{ body: string; prospect: Prospect }>();

  const system = `Generate two different subject line variants (A and B) for the same email body.
- Variant A: curiosity-driven, question format
- Variant B: benefit-led, direct
Both must be under 50 characters. No spam words.
Respond with JSON: { "a": "...", "b": "..." }`;

  const user = `Email body:\n${body}\n\nProspect: ${prospect.name} at ${prospect.company ?? "unknown"}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 100 });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Prompt coach (F21) ────────────────────────────────────────────────────────

app.post("/prompt-coach", async (c) => {
  const { subject, body, prospect } = await c.req.json<{
    subject: string;
    body: string;
    prospect: Prospect;
  }>();

  const system = `You are a cold email coach. Analyze this email draft and provide:
1. An overall quality score 0-100
2. Breakdown by: personalisation (30), clarity (25), cta (25), tone (20)
3. Up to 5 specific suggestions for improvement
4. Up to 3 quick fixes: specific text ranges to replace with better alternatives

Respond with JSON: {
  "score": number,
  "breakdown": { "personalisation": n, "clarity": n, "cta": n, "tone": n },
  "suggestions": ["...", "..."],
  "quickFixes": [{ "field": "subject"|"body", "range": [start, end], "replacement": "..." }]
}`;

  const user = `Prospect: ${buildProspectContext(prospect)}
Subject: ${subject}
Body: ${body}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 300, ttl: TTL_SHORT });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Subject line lab (F25) ───────────────────────────────────────────────────

app.post("/subject-lab", async (c) => {
  const { body, prospect, count = 10 } = await c.req.json<{
    body: string;
    prospect: Prospect;
    count?: number;
  }>();

  const strategies = [
    "curiosity", "benefit-led", "question", "personalized", "urgent-mild",
    "social-proof", "data-driven", "pattern-interrupt", "objection-preemptive", "short-punchy",
  ];

  const system = `You are a cold email subject line expert. Generate ${count} distinct subject line variants for the given email body and prospect.
Each variant should use a different strategy from: ${strategies.join(", ")}.
Rank each by predicted open rate (0-100).
All under 50 chars. No spam words.

Respond with JSON: {
  "variants": [{ "subject": "...", "strategy": "...", "predictedOpenRate": number, "reasoning": "..." }]
}
Sort by predictedOpenRate descending.`;

  const user = `Email body:\n${body}\n\nProspect: ${prospect.name} at ${prospect.company ?? "unknown"}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 600, ttl: TTL_SHORT });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Campaign outcome predictor (F27) ─────────────────────────────────────────

app.post("/predict-campaign", async (c) => {
  const { prospectCount, avgScore, persona, templateStats, historicalBenchmarks } = await c.req.json<{
    prospectCount: number;
    avgScore: number;
    persona?: Persona;
    templateStats?: { openRate: number; replyRate: number; coachScore?: number };
    historicalBenchmarks?: { avgOpenRate: number; avgReplyRate: number; avgConvRate: number };
  }>();

  const personaSection = persona
    ? `\nPersona tone: ${persona.tone}, expertise: ${persona.expertise}`
    : "";
  const templateSection = templateStats
    ? `\nTemplate stats: openRate=${templateStats.openRate}%, replyRate=${templateStats.replyRate}%`
    : "";
  const benchSection = historicalBenchmarks
    ? `\nHistorical benchmarks: openRate=${historicalBenchmarks.avgOpenRate}%, replyRate=${historicalBenchmarks.avgReplyRate}%`
    : "";

  const system = `You are a B2B campaign performance analyst. Predict campaign outcome.
Respond with JSON: {
  "predictedOpenRate": number (0-100),
  "predictedReplyRate": number (0-100),
  "predictedConvRate": number (0-100),
  "confidence": number (0-1),
  "riskFactors": ["..."],
  "suggestions": ["..."]
}`;

  const user = `Campaign: ${prospectCount} prospects, avg lead score ${avgScore}${personaSection}${templateSection}${benchSection}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 250, ttl: TTL_MEDIUM });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Cadence optimizer (F30) ──────────────────────────────────────────────────

app.post("/optimize-cadence", async (c) => {
  const { campaignHistory, targetMetric = "reply_rate" } = await c.req.json<{
    campaignHistory: Array<{
      prospectCount: number;
      touchCount: number;
      avgDelayDays: number;
      openRate: number;
      replyRate: number;
      conversionRate?: number;
    }>;
    targetMetric?: string;
  }>();

  const system = `You are a B2B outreach optimization analyst. Analyze campaign performance data and recommend optimal cadence.
Respond with JSON: {
  "recommendedTouches": number,
  "recommendedDelays": [number],
  "recommendedSendDays": ["Tuesday", "..."],
  "recommendedSendWindow": { "start": "HH:MM", "end": "HH:MM" },
  "confidence": number (0-1),
  "reasoning": "...",
  "topInsights": ["..."]
}`;

  const user = `Historical data (${campaignHistory.length} campaigns, target: ${targetMetric}):\n${
    campaignHistory.map((c, i) =>
      `#${i + 1}: ${c.touchCount} touches, ${c.avgDelayDays}d avg delay, open=${(c.openRate * 100).toFixed(1)}%, reply=${(c.replyRate * 100).toFixed(1)}%`
    ).join("\n")
  }`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 300, ttl: TTL_MEDIUM });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ─── Re-engage email (F29) ───────────────────────────────────────────────────

app.post("/reengage-email", async (c) => {
  const { prospect, lastActivityDays, previousEmails } = await c.req.json<{
    prospect: Prospect;
    lastActivityDays: number | null;
    previousEmails: Array<{ subject: string; sentAt: Date | null }>;
  }>();

  const system = `You are a warm re-engagement email writer. Write a brief email acknowledging the gap, offering new value, with a soft CTA.
Rules: under 80 words, warm tone, no guilt-tripping, one clear value proposition.
Respond with JSON: { "subject": "...", "body": "..." }`;

  const user = `Prospect: ${buildProspectContext(prospect)}
Days since last activity: ${lastActivityDays ?? "unknown"}
Previous emails: ${previousEmails.map((e) => e.subject).join(", ") || "none"}`;

  try {
    const result = await chat(c.env, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { json: true, maxTokens: 200 });

    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

export default app;
