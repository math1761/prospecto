export type BounceClass = "hard" | "soft" | "transient";

export function classifyBounce(smtpCode: string, diagnostic: string): {
  bounceClass: BounceClass;
  shouldRetry: boolean;
  retryDelayMs: number;
} {
  const code = parseInt(smtpCode, 10);

  // 5xx = permanent failure
  if (code >= 500) {
    // Some 5xx are actually retryable
    const softPatterns = ["mailbox full", "quota exceeded", "temporarily blocked", "rate limit", "greylisted"];
    const lower = diagnostic.toLowerCase();
    if (softPatterns.some((p) => lower.includes(p))) {
      return { bounceClass: "soft", shouldRetry: true, retryDelayMs: 4 * 3600 * 1000 };
    }
    return { bounceClass: "hard", shouldRetry: false, retryDelayMs: 0 };
  }

  // 4xx = transient
  if (code >= 400) {
    return { bounceClass: "transient", shouldRetry: true, retryDelayMs: 3600 * 1000 };
  }

  // Unknown — treat as transient
  return { bounceClass: "transient", shouldRetry: true, retryDelayMs: 3600 * 1000 };
}
