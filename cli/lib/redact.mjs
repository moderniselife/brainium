// Secret redaction for anything Brainium stores. Conservative on purpose:
// a false positive costs a word of context, a false negative leaks a key.
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:rk|sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, // credentials in URLs
];

// KEY=value / "key": "value" where the key smells secret.
const ASSIGNMENT =
  /((?:["']?)[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|auth|credential|session[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["']?)([^\s"',;}]{6,})\2/gi;

export const REDACTED = "[REDACTED]";

export function redact(text) {
  if (typeof text !== "string" || text === "") return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, (m) => (m.includes("://") ? m.replace(/:[^:@/]+@$/, `:${REDACTED}@`) : REDACTED));
  out = out.replace(ASSIGNMENT, (_m, key, q) => `${key}${q}${REDACTED}${q}`);
  return out;
}

/** True when text still looks like it carries a secret after redaction. */
export function containsSecret(text) {
  return redact(text) !== text;
}
