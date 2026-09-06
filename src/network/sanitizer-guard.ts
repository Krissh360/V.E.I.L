/**
 * Sanitizer Guard — runtime assertion layer that scans serialized payloads
 * for leaked PII patterns before they leave the device.
 *
 * Belt-and-suspenders defense: even if the VEIL filter has a bug,
 * this guard catches raw PII in the final JSON before it's transmitted.
 */

const MODULE = 'SanitizerGuard';

/** PII patterns to check for in the serialized payload */
const PII_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'Email', regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { name: 'Phone (10+ digits)', regex: /(?<!\d)\+?\d[\d\-\s.()]{8,}\d(?!\d)/g },
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'Aadhaar', regex: /\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/g },
  { name: 'PAN', regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
];

/** Allowlisted values that look like PII but are safe */
const ALLOWLIST = new Set([
  'safe-test@example.com', // Placeholder from the stub server
  'RAAP-1',               // Scheme version
]);

/** Patterns that are expected in RAAP tokens and should not trigger alerts */
const TOKEN_PATTERN = /\[REDACTED:[A-Z_]+:\d+\]/g;

/**
 * Scan a serialized JSON string for leaked PII patterns.
 * Throws if any unredacted PII is found.
 *
 * @param jsonString - The serialized RAAP payload
 * @throws Error if PII is detected in the payload
 */
export function assertNoPIILeaked(jsonString: string): void {
  // Strip out redaction tokens so they don't trigger false positives
  const cleaned = jsonString.replace(TOKEN_PATTERN, '');

  const violations: string[] = [];

  for (const { name, regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(cleaned)) !== null) {
      const value = match[0].trim();
      if (ALLOWLIST.has(value)) continue;

      // Check if this is inside a URL field (the sanitized URL might have domain parts)
      // that look like an email to a naive regex
      if (name === 'Email') {
        // Allow common TLD-like patterns in URLs
        if (value.includes('localhost') || value.includes('example.com')) continue;
      }

      violations.push(`${name}: "${value}" at offset ${match.index}`);
    }
  }

  if (violations.length > 0) {
    const errorMsg =
      `[VEIL:${MODULE}] PII LEAK DETECTED — blocking payload transmission!\n` +
      `Found ${violations.length} potential PII leak(s):\n` +
      violations.map((v) => `  • ${v}`).join('\n');

    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.debug(`[VEIL:${MODULE}] Payload passed sanitizer guard check`);
}
