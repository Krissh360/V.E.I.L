/**
 * RAAP v1 — Redacted Accessibility & Action Payload
 *
 * This is the ONLY data structure that may leave the device.
 * It contains a sanitized DOM tree, a redaction map, and optionally
 * a blurred screenshot with all sensitive regions destroyed.
 *
 * The branded `__raapBrand` field prevents accidental construction —
 * only the VEIL filter should create instances via `createRaapPayload()`.
 */

import type { DetectionType, ImageRegion, DOMLocation } from './detection';

// ─── Brand for compile-time safety ───────────────────────────────────
declare const __raapBrand: unique symbol;

/**
 * Branded RAAP v1 Payload — the network layer only accepts this type.
 * Cannot be constructed directly; must go through the VEIL filter.
 */
export type RaapV1Payload = {
  /** Schema version identifier */
  schemeVersion: 'RAAP-1';
  /** When this payload was created */
  timestamp: number;
  /** Page URL (sanitized — query params with PII stripped) */
  url: string;
  /** Redacted DOM tree — all PII replaced with typed tokens */
  graph: RedactedDOMNode[];
  /** Map of all redactions applied */
  redactionMap: RedactionEntry[];
  /** Blurred screenshot with all sensitive regions destroyed, or null if omitted */
  image: RedactedImage | null;
  /** Pipeline performance metrics */
  metrics: PipelineMetricsData;
} & { readonly [__raapBrand]: true };

/** A DOM node with redactions applied */
export interface RedactedDOMNode {
  tag: string;
  role?: string;
  /** Attributes with sensitive values replaced */
  attributes: Record<string, string>;
  /** Text content with PII replaced by [REDACTED:TYPE:N] tokens */
  textContent?: string;
  children: RedactedDOMNode[];
  xpath: string;
  cssSelector?: string;
}

/** Record of a single redaction that was applied */
export interface RedactionEntry {
  /** What type of PII was redacted */
  type: DetectionType;
  /** The replacement token used (e.g., "[REDACTED:EMAIL:1]") */
  token: string;
  /** Where the redaction was applied */
  location: ImageRegion | DOMLocation;
  /** Detection confidence that triggered this redaction */
  confidence: number;
}

/** A screenshot with all sensitive regions destructively blurred */
export interface RedactedImage {
  /** Base64 data URL of the blurred image */
  dataUrl: string;
  width: number;
  height: number;
  /** How many regions were blurred */
  redactedRegions: number;
}

/** Pipeline timing and detection count data */
export interface PipelineMetricsData {
  /** Milliseconds for each pipeline stage */
  timings: Record<string, number>;
  /** Detection counts by type */
  detectionCounts: Partial<Record<DetectionType, number>>;
  /** Total detections */
  totalDetections: number;
}

/**
 * Creates a branded RAAP v1 payload. ONLY the VEIL filter should call this.
 * This is the sole constructor — enforcing the architectural invariant that
 * all outbound data must pass through the redaction gate.
 */
export function createRaapPayload(
  data: Omit<RaapV1Payload, typeof __raapBrand>
): RaapV1Payload {
  // Runtime validation
  if (data.schemeVersion !== 'RAAP-1') {
    throw new Error(`Invalid RAAP scheme version: ${data.schemeVersion}`);
  }
  // Brand the object at runtime (the brand is a compile-time-only concept,
  // but we freeze it to prevent tampering)
  return Object.freeze(data) as RaapV1Payload;
}
