// Client-side SpamAssassin-style heuristic checks
// Returns score 0–100 (lower = better) and flagged reasons

const SPAM_PHRASES = [
  "free money", "100% free", "click here", "limited time", "act now",
  "guaranteed", "no risk", "winner", "congratulations", "urgent",
  "make money fast", "work from home", "earn extra cash", "increase sales",
  "special promotion", "buy now", "order now", "cash bonus", "dear friend",
];

const SPAM_SUBJECTS = [
  "re:", "fw:", "fwd:", "hello", "hi there", "important", "!!!", "???",
];

export function spamCheck(subject: string, body: string): {
  score: number;
  flags: string[];
} {
  const flags: string[] = [];
  let score = 0;

  const combined = `${subject} ${body}`.toLowerCase();

  // Spam phrases
  for (const phrase of SPAM_PHRASES) {
    if (combined.includes(phrase)) {
      flags.push(`Contains spam phrase: "${phrase}"`);
      score += 8;
    }
  }

  // ALL CAPS words (3+ chars)
  const capsWords = body.match(/\b[A-Z]{3,}\b/g) ?? [];
  if (capsWords.length > 3) {
    flags.push(`Excessive CAPS: ${capsWords.slice(0, 3).join(", ")}...`);
    score += capsWords.length * 3;
  }

  // Excessive exclamation marks
  const exclamations = (body.match(/!/g) ?? []).length;
  if (exclamations > 2) {
    flags.push(`Excessive exclamation marks (${exclamations})`);
    score += exclamations * 4;
  }

  // Excessive links
  const links = (body.match(/https?:\/\//g) ?? []).length;
  if (links > 3) {
    flags.push(`Too many links (${links})`);
    score += links * 5;
  }

  // Short subject line check
  if (subject.length < 5) {
    flags.push("Subject line too short");
    score += 15;
  }

  // Risky subject keywords
  for (const kw of SPAM_SUBJECTS) {
    if (subject.toLowerCase().startsWith(kw)) {
      flags.push(`Spam-like subject start: "${kw}"`);
      score += 10;
    }
  }

  // No personalisation placeholder used
  if (!body.includes("{{") && body.length < 100) {
    flags.push("Very short body with no personalisation");
    score += 10;
  }

  return { score: Math.min(score, 100), flags };
}
