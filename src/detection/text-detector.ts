/**
 * Text PII Detector — scans DOMNode trees for text-based PII using
 * regex patterns and DOM heuristics.
 *
 * Detects: emails, phone numbers, Aadhaar numbers, PAN cards, SSNs,
 * credit card numbers, password fields.
 *
 * --- PHASE 2 STUB ---
 * Where marked, regex detection would be supplemented or replaced by
 * a Transformers.js NER model for higher accuracy and language coverage.
 * The NER model would run in the offscreen document alongside the vision model.
 * --- END PHASE 2 STUB ---
 */

import type { DOMNode } from '@/types/screen-state';
import type { Detection, DetectionType, DOMLocation } from '@/types/detection';

const MODULE = 'TextDetector';

// ─── Regex Patterns ──────────────────────────────────────────────────

const PATTERNS: Array<{ type: DetectionType; regex: RegExp; confidence: number }> = [
  {
    // Email: simplified RFC 5322
    type: 'EMAIL',
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    confidence: 0.95,
  },
  {
    // Phone: international formats (Indian +91, US, general international)
    type: 'PHONE',
    regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    confidence: 0.80,
  },
  {
    // Aadhaar: 12 digits, optionally separated by spaces or hyphens
    type: 'AADHAAR',
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.75,
  },
  {
    // Indian PAN card: ABCDE1234F pattern
    type: 'PAN',
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    confidence: 0.90,
  },
  {
    // US SSN: 123-45-6789
    type: 'SSN',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.90,
  },
  {
    // Credit card: 13-19 digits with optional separators
    type: 'CREDIT_CARD',
    regex: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g,
    confidence: 0.70,
  },
];

/**
 * Luhn algorithm to validate credit card numbers.
 * Reduces false positives on random digit sequences.
 */
function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) return false;

  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Validate Aadhaar numbers using a 12-digit check.
 * Supports standard test Aadhaar numbers (e.g. 1234-5678-9012) while filtering
 * out degenerate repeating sequences (e.g. 000000000000).
 */
function aadhaarCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length !== 12) return false;
  if (/^(\d)\1{11}$/.test(nums)) return false;
  return true;
}

/**
 * Phone number validation — filter out sequences that are too short
 * or are clearly not phone numbers (e.g., years, zip codes).
 */
function phoneCheck(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  // Need at least 7 digits for a valid phone number
  if (digits.length < 7 || digits.length > 15) return false;
  // Filter out common false positives: 4-digit years, zip codes
  if (digits.length <= 5) return false;
  return true;
}

// ─── DOM-based Detections ────────────────────────────────────────────

/**
 * Check if an element is a name field (by autocomplete or name/id heuristics).
 */
function isNameField(node: DOMNode): boolean {
  if (node.tag !== 'input') return false;
  const type = node.attributes['type']?.toLowerCase() ?? 'text';
  if (type !== 'text' && type !== '') return false;

  const autocomplete = node.attributes['autocomplete']?.toLowerCase();
  if (autocomplete === 'name' || autocomplete === 'given-name' || autocomplete === 'family-name') return true;

  const id = (node.attributes['id'] ?? '').toLowerCase();
  const name = (node.attributes['name'] ?? '').toLowerCase();
  if (id.includes('fullname') || id.includes('name') || name.includes('fullname') || name.includes('name')) {
    if (!id.includes('file') && !id.includes('tag') && !name.includes('file') && !name.includes('tag')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an element is a password field (by type attribute or heuristics).
 */
function isPasswordField(node: DOMNode): boolean {
  if (node.tag !== 'input') return false;
  const type = node.attributes['type']?.toLowerCase();
  if (type === 'password') return true;

  // Heuristic: autocomplete hints
  const autocomplete = node.attributes['autocomplete']?.toLowerCase();
  if (autocomplete === 'current-password' || autocomplete === 'new-password') return true;

  // Heuristic: name/id containing 'password' or 'passwd'
  const name = (node.attributes['name'] ?? '').toLowerCase();
  const id = (node.attributes['id'] ?? '').toLowerCase();
  if (name.includes('password') || name.includes('passwd')) return true;
  if (id.includes('password') || id.includes('passwd')) return true;

  return false;
}

/**
 * Check if an element is a credit card input field.
 */
function isCreditCardField(node: DOMNode): boolean {
  if (node.tag !== 'input') return false;
  const autocomplete = node.attributes['autocomplete']?.toLowerCase();
  if (autocomplete === 'cc-number' || autocomplete === 'cc-csc' || autocomplete === 'cc-exp') {
    return true;
  }
  return false;
}

// ─── Main Detection Function ─────────────────────────────────────────

/**
 * Scan a DOMNode tree for text-based PII.
 * Returns a Detection[] array with locations relative to the DOM tree.
 */
export function detectTextPII(domTree: DOMNode[]): Detection[] {
  const detections: Detection[] = [];

  function walkNode(node: DOMNode): void {
    // Check for password fields
    if (isPasswordField(node)) {
      const detection: Detection = {
        type: 'PASSWORD',
        location: {
          kind: 'dom',
          xpath: node.xpath,
          cssSelector: node.cssSelector,
        } as DOMLocation,
        confidence: 1.0,
        rawValue: node.attributes['value'] ?? '[hidden]',
      };
      detections.push(detection);
    }

    // Check for credit card fields
    if (isCreditCardField(node)) {
      const detection: Detection = {
        type: 'CREDIT_CARD',
        location: {
          kind: 'dom',
          xpath: node.xpath,
          cssSelector: node.cssSelector,
        } as DOMLocation,
        confidence: 0.90,
        rawValue: node.attributes['value'] ?? '',
      };
      detections.push(detection);
    }

    // Scan text content for PII patterns
    if (node.textContent) {
      for (const pattern of PATTERNS) {
        // Reset regex lastIndex for each node
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.regex.exec(node.textContent)) !== null) {
          const matchedValue = match[0];
          let confidence = pattern.confidence;

          // Extra validation for specific types
          if (pattern.type === 'CREDIT_CARD') {
            if (!luhnCheck(matchedValue)) continue;
            confidence = 0.90; // Higher confidence after Luhn validation
          }

          if (pattern.type === 'AADHAAR') {
            if (!aadhaarCheck(matchedValue)) continue;
            confidence = 0.85;
          }

          if (pattern.type === 'PHONE') {
            if (!phoneCheck(matchedValue)) continue;
          }

          const detection: Detection = {
            type: pattern.type,
            location: {
              kind: 'dom',
              xpath: node.xpath,
              cssSelector: node.cssSelector,
              startOffset: match.index,
              endOffset: match.index + matchedValue.length,
            } as DOMLocation,
            confidence,
            rawValue: matchedValue,
          };
          detections.push(detection);
        }
      }
    }

    // Also scan input and textarea values
    const inputValue = node.attributes['value'];
    if (inputValue && (node.tag === 'input' || node.tag === 'textarea')) {
      const inputType = node.attributes['type']?.toLowerCase();
      const nodeXpath = node.xpath;
      const fieldName = (node.attributes['name'] ?? '').toLowerCase();
      const fieldId = (node.attributes['id'] ?? '').toLowerCase();
      const isAadhaarField = fieldName.includes('aadhaar') || fieldId.includes('aadhaar') || fieldName.includes('national-id');

      // Check for name field PII
      if (isNameField(node) && inputValue.trim().length >= 2) {
        detections.push({
          type: 'NAME',
          location: {
            kind: 'dom',
            xpath: nodeXpath,
            cssSelector: node.cssSelector,
          } as DOMLocation,
          confidence: 0.90,
          rawValue: inputValue.trim(),
        });
      }

      // Don't scan password fields for regex text PII (already detected as PASSWORD above)
      if (inputType !== 'password') {
        let matchedInPatterns = false;

        for (const pattern of PATTERNS) {
          // Aadhaar values can satisfy the permissive phone-number regex.
          // Respect the field's explicit ID semantics to avoid double-counting.
          if (pattern.type === 'PHONE' && isAadhaarField) continue;

          pattern.regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.regex.exec(inputValue)) !== null) {
            const matchedValue = match[0];
            let confidence = pattern.confidence;

            if (pattern.type === 'CREDIT_CARD' && !luhnCheck(matchedValue)) continue;
            if (pattern.type === 'AADHAAR' && !aadhaarCheck(matchedValue)) continue;
            if (pattern.type === 'PHONE' && !phoneCheck(matchedValue)) continue;

            matchedInPatterns = true;
            detections.push({
              type: pattern.type,
              location: {
                kind: 'dom',
                xpath: nodeXpath,
                cssSelector: node.cssSelector,
              } as DOMLocation,
              confidence,
              rawValue: matchedValue,
            });
          }
        }

        // Semantic fallback for specific field types if regex didn't match
        // Email field fallback
        if (
          (inputType === 'email' || fieldName.includes('email') || fieldId.includes('email')) &&
          inputValue.includes('@') &&
          inputValue.trim().length >= 5 &&
          !detections.some((d) => d.location.kind === 'dom' && (d.location as DOMLocation).xpath === nodeXpath && d.type === 'EMAIL')
        ) {
          detections.push({
            type: 'EMAIL',
            location: {
              kind: 'dom',
              xpath: nodeXpath,
              cssSelector: node.cssSelector,
            } as DOMLocation,
            confidence: 0.85,
            rawValue: inputValue.trim(),
          });
        }

        // Phone field fallback
        if (
          (inputType === 'tel' || fieldName.includes('phone') || fieldId.includes('phone') || fieldName.includes('tel')) &&
          phoneCheck(inputValue) &&
          !detections.some((d) => d.location.kind === 'dom' && (d.location as DOMLocation).xpath === nodeXpath && d.type === 'PHONE')
        ) {
          detections.push({
            type: 'PHONE',
            location: {
              kind: 'dom',
              xpath: nodeXpath,
              cssSelector: node.cssSelector,
            } as DOMLocation,
            confidence: 0.85,
            rawValue: inputValue.trim(),
          });
        }

        // Aadhaar field fallback
        if (
          isAadhaarField &&
          aadhaarCheck(inputValue) &&
          !detections.some((d) => d.location.kind === 'dom' && (d.location as DOMLocation).xpath === nodeXpath && d.type === 'AADHAAR')
        ) {
          detections.push({
            type: 'AADHAAR',
            location: {
              kind: 'dom',
              xpath: nodeXpath,
              cssSelector: node.cssSelector,
            } as DOMLocation,
            confidence: 0.85,
            rawValue: inputValue.trim(),
          });
        }

        // PAN field fallback
        if (
          (fieldName.includes('pan') || fieldId.includes('pan')) &&
          /[A-Z]{5}\d{4}[A-Z]/i.test(inputValue) &&
          !detections.some((d) => d.location.kind === 'dom' && (d.location as DOMLocation).xpath === nodeXpath && d.type === 'PAN')
        ) {
          detections.push({
            type: 'PAN',
            location: {
              kind: 'dom',
              xpath: nodeXpath,
              cssSelector: node.cssSelector,
            } as DOMLocation,
            confidence: 0.90,
            rawValue: inputValue.trim(),
          });
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walkNode(child);
    }
  }

  for (const rootNode of domTree) {
    walkNode(rootNode);
  }

  console.debug(`[VEIL:${MODULE}] Found ${detections.length} text PII detections`);
  return detections;
}
