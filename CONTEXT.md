# CONTEXT.md — Prospecto

## What this is

Prospection tool. Upload a CSV of prospects, generate personalised outreach emails via AI, send them from the platform.

## Core features

1. **CSV import** — upload a prospect list; parse and display rows in a table UI
2. **Prospect list** — browse, filter, and select prospects from imported CSV data
3. **AI email generation** — per-prospect email generation via [OpenRouter](https://openrouter.ai/) using a free model (e.g. `google/gemini-flash-1.5` or `meta-llama/llama-3.1-8b-instruct:free`)
4. **Email sending** — send generated emails directly from the platform
5. **n8n integration** — webhook/API surface so n8n workflows can trigger generation and sending steps

## Extended feature set

| # | Feature | Description |
|---|---|---|
| 1 | **CSV column mapping** | UI to map arbitrary CSV headers to internal fields (`name`, `email`, `company`, etc.) — handles any CSV shape |
| 2 | **Prospect status tracking** | Per-prospect lifecycle: `new → contacted → replied → converted → rejected`. Persisted in D1. |
| 3 | **Email template library** | Save and reuse prompt templates with `{{variable}}` placeholders; pick template before generating |
| 4 | **Bulk AI generation** | Generate emails for all selected prospects in one click; queued via Cloudflare Queue to avoid rate limits |
| 5 | **Inline email editor** | Review and edit AI-generated email before sending; rich-text or plain-text toggle |
| 6 | **Duplicate detection** | Flag duplicate `email` values on import; show diff and let user merge or skip |
| 7 | **Sending scheduler** | Set a daily send limit and time window; spread sends to avoid spam triggers |
| 8 | **Campaign management** | Group prospects into named campaigns; track per-campaign stats separately |
| 9 | **Open & click tracking** | Inject tracking pixel + rewrite links; record opens/clicks back to prospect record |
| 10 | **Reply detection** | Poll or webhook inbox for replies; auto-update prospect status to `replied` |
| 11 | **Follow-up sequences** | Define multi-step drip (e.g. day 0 intro, day 3 follow-up, day 7 last attempt); auto-trigger next step |
| 12 | **A/B subject testing** | Generate two subject line variants; split-send and surface winner by open rate |
| 13 | **Prospect enrichment** | Call a free enrichment API (e.g. Hunter.io, Clearbit free tier) to fill missing fields before generation |
| 14 | **Import history & audit log** | Track every CSV import, email send, and status change with timestamp and actor |
| 15 | **Analytics dashboard** | Funnel view: imported → contacted → replied → converted; open rate, click rate, reply rate charts |
| 16 | **CSV export** | Export filtered/selected prospects (with status, sent date, open count) back to CSV |
| 17 | **n8n outbound webhooks** | Fire webhook to n8n on prospect status change (e.g. `replied` triggers CRM update in n8n) |
| 18 | **Unsubscribe management** | Auto-append unsubscribe link; one-click opt-out sets status to `unsubscribed` and blocks future sends |
| 19 | **Sending domain health** | Show SPF/DKIM/DMARC status for configured sending domain; warn before first send if misconfigured |
| 20 | **Multi-user & roles** | Team accounts with roles: `admin` (full access), `sender` (generate + send), `viewer` (read-only) |

## Killer features

| # | Feature | Description |
|---|---|---|
| 1 | **AI sender persona** | Define tone, expertise, writing style for the "sender" persona; all generation inherits it — consistent brand voice across 1000s of emails |
| 2 | **Website context scraper** | Paste prospect's company URL; worker fetches and summarises the page, injects it into the AI prompt automatically — zero manual research |
| 3 | **Intent signal injection** | Pull recent company news (funding, hiring surge, product launch) via news API; AI references the signal in the opening line for hyper-relevance |
| 4 | **AI email quality score** | Before sending, AI scores the draft on personalisation, clarity, and call-to-action strength (0–100); block sends below threshold |
| 5 | **Spam score pre-check** | Run draft through SpamAssassin-style heuristics; flag risky phrases, ALL CAPS, excessive links before send |
| 6 | **Smart send-time prediction** | Estimate optimal send time per prospect from their timezone + industry open-rate benchmarks; auto-schedule to that slot |
| 7 | **Multi-language auto-detect** | Infer prospect's language from domain TLD or country field; generate email in their language without any manual switch |
| 8 | **Email chain follow-up** | Paste an existing reply thread; AI reads the context and writes a contextually aware follow-up, not a generic second touch |
| 9 | **Objection AI responder** | When a reply contains a rejection or objection, surface an AI-suggested response tailored to the specific pushback |
| 10 | **Prompt version control** | Version prompt templates with semver; compare open/reply rates across versions to iterate on what actually works |
| 11 | **Prospect lead scoring** | Score prospects 0–100 based on company size, industry fit, job title seniority; sort table by score, focus effort on top quartile |
| 12 | **Deal value estimator** | Tag prospects with estimated ARR/deal size; weight campaign priority by revenue potential, not just volume |
| 13 | **Multi-channel message variants** | From one AI generation, produce: long email, short LinkedIn DM, WhatsApp message — same pitch, right format per channel |
| 14 | **CRM bi-directional sync** | Push new prospects to HubSpot/Pipedrive; pull deal stage back and update prospect status automatically |
| 15 | **Personalised video placeholder** | Generate a Loom-style personalised video thumbnail card per prospect (company name + logo overlaid); embed in email as a pattern interrupt |
| 16 | **Competitor-aware pitching** | Detect which tools the prospect uses (via BuiltWith or job post scraping); AI adjusts pitch to position against their current stack |
| 17 | **LinkedIn profile import** | Paste a LinkedIn URL; a scraper fills `name`, `company`, `title`, `location` fields — no CSV needed for single prospects |
| 18 | **Reply sentiment dashboard** | Classify every reply as `positive / neutral / negative / out-of-office`; aggregate sentiment per campaign to detect messaging quality issues early |
| 19 | **Warm-up mode** | Gradual ramp for new sending domains: auto-limits daily volume to a configurable curve (5 → 10 → 20 → 50…) until domain reputation is established |
| 20 | **One-click n8n workflow export** | Export any campaign as a ready-to-import n8n workflow JSON — trigger on new CSV row, generate, send, update CRM — no n8n setup knowledge needed |
| 21 | **AI prompt coach** | Live editor sidebar scores your template as you write; flags weak CTAs, spam triggers, generic phrases; suggests rewrites inline — iterate before you send |
| 22 | **Bounce intelligence** | Auto-parse SMTP bounces, classify hard/soft/transient; retry soft bounces with exponential backoff, suppress hard bounces permanently — protect sender reputation |
| 23 | **Email threading engine** | Follow-ups thread under the same conversation (References + In-Reply-To headers); prospects see continuity, not disconnected cold emails |
| 24 | **Deliverability scorecard** | Single 0–100 score combining SPF/DKIM/DMARC + bounce rate + spam complaint rate + volume trend; alert before reputation drops |
| 25 | **AI subject line lab** | Generate 10 subject variants ranked by predicted open rate; auto A/B test top 2 on 10% of list, send winner to remaining 90% |
| 26 | **Prospect activity timeline** | Unified per-prospect feed: every open, click, reply, status change, note — full interaction history in one chronological view |
| 27 | **Campaign outcome predictor** | Pre-send AI analysis of template quality + audience fit + historical performance → estimated open/reply/conversion rates before you hit send |
| 28 | **Multi-client email preview** | One-click render in Gmail (desktop + mobile), Outlook, Apple Mail layouts; catch broken formatting before any prospect sees it |
| 29 | **Contact decay engine** | Auto-flag stale prospects (no engagement in X days, job change signals); suggest archive or re-engage with a fresh angle |
| 30 | **AI cadence optimizer** | Analyse past campaign performance per industry/segment; recommend optimal touch count, delays, and send times for new campaigns |

## Data flow

```
CSV upload → parse prospects → select prospect
  → call OpenRouter (free model) with prospect context
  → review / edit generated email
  → send email
  → (optionally) n8n webhook triggers any of the above steps
```

## Stack decisions

- **Frontend**: Next.js 16 App Router + OpenNext Cloudflare adapter — deployed as a Cloudflare Worker
- **services/api**: Hono — REST API gateway, Drizzle ORM, PostgreSQL via Hyperdrive
- **services/ai**: Hono — OpenRouter calls (free model by default), generation + scoring
- **services/mailer**: Hono — Resend email dispatch, open/click tracking pixel
- **Database**: PostgreSQL; local via Docker Compose, production via Cloudflare Hyperdrive
- **Service communication**: Cloudflare Service Bindings (private, zero-latency, no HTTP cost)
- **n8n**: `services/api` exposes REST endpoints consumed by n8n HTTP Request nodes

## CSV schema (expected columns)

To be defined. At minimum: `name`, `email`, `company`. Additional columns feed the AI prompt as context.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | `services/ai/.dev.vars` | OpenRouter AI generation |
| `RESEND_API_KEY` | `services/mailer/.dev.vars` | Resend email dispatch |
| `FROM_EMAIL` | `services/mailer/.dev.vars` | Sender email address |
| `FROM_NAME` | `services/mailer/.dev.vars` | Sender display name |
| `API_BASE_URL` | `services/mailer/.dev.vars` | API base URL for tracking |
