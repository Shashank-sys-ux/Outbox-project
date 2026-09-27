const TOKEN_SEPARATORS = /[\s,;|<>()[\]{}]+/;
const EDGE_QUOTES = /^["'`]+|["'`.:]+$/g;
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_INVALID_SAMPLES = 10;

export interface ParseStats {
  candidates: number;
  valid: number;
  invalid: number;
  duplicates: number;
  truncated: number;
}

export interface ParseResult {
  emails: string[];
  invalidSamples: string[];
  stats: ParseStats;
}

export function normalizeEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").toLowerCase();
}

export function isValidEmail(value: string): boolean {
  if (value.length > 254) {
    return false;
  }
  const at = value.lastIndexOf("@");
  if (at <= 0 || at !== value.indexOf("@")) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) {
    return false;
  }
  const tld = labels[labels.length - 1] ?? "";
  return /^[a-z]{2,63}$/.test(tld) || /^xn--[a-z0-9-]{1,59}$/.test(tld);
}

export function parseEmailList(text: string, maxRecipients: number): ParseResult {
  const content = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalidSamples: string[] = [];
  const stats: ParseStats = { candidates: 0, valid: 0, invalid: 0, duplicates: 0, truncated: 0 };

  for (const rawToken of content.split(TOKEN_SEPARATORS)) {
    const token = normalizeEmail(rawToken.replace(EDGE_QUOTES, ""));
    if (!token.includes("@")) {
      continue;
    }
    stats.candidates += 1;

    if (!isValidEmail(token)) {
      stats.invalid += 1;
      if (invalidSamples.length < MAX_INVALID_SAMPLES) {
        invalidSamples.push(token.slice(0, 100));
      }
      continue;
    }
    if (seen.has(token)) {
      stats.duplicates += 1;
      continue;
    }
    seen.add(token);
    if (emails.length >= maxRecipients) {
      stats.truncated += 1;
      continue;
    }
    emails.push(token);
  }

  stats.valid = emails.length;
  return { emails, invalidSamples, stats };
}

export function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0);
}
