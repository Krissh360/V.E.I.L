/**
 * VEIL Filter — THE GATE
 *
 * This is the single, safety-critical module that transforms a raw ScreenState
 * (containing unredacted pixels + DOM) into a sanitized RaapV1Payload that is
 * safe to transmit off-device.
 *
 * ARCHITECTURAL INVARIANT:
 * - This is the ONLY code path that creates a RaapV1Payload.
 * - The network layer only accepts RaapV1Payload (branded type).
 * - After processing, the original ScreenState.screenshot is nullified.
 * - No raw PII may survive in the output payload.
 *
 * The module is designed to be heavily tested. If this fails, privacy is breached.
 */

import type { ScreenState, DOMNode } from '@/types/screen-state';
import type { Detection, ImageRegion } from '@/types/detection';
import type { RaapV1Payload, PipelineMetricsData } from '@/types/raap';
import { createRaapPayload } from '@/types/raap';
import { redactText } from './text-redactor';
import { blurImageRegions } from './image-redactor';

const MODULE = 'VeilFilter';

/**
 * The main VEIL filter function — transforms raw state into a safe payload.
 *
 * @param state - The raw ScreenState (WILL BE MUTATED: screenshot nullified)
 * @param detections - All detected PII (from text + image pipelines)
 * @param metrics - Pipeline timing data
 * @returns A branded RaapV1Payload safe for transmission
 */
export async function applyVeilFilter(
  state: ScreenState,
  detections: Detection[],
  metrics: PipelineMetricsData,
): Promise<RaapV1Payload> {
  console.info(`[VEIL:${MODULE}] Applying VEIL filter: ${detections.length} detections`);

  // 1. Separate image and DOM detections
  const imageDetections = detections.filter((d) => d.location.kind === 'image');
  const textDetections = detections.filter((d) => d.location.kind === 'dom');

  // 2. Redact text in the DOM tree (deep clone + token replacement)
  const { redactedTree, entries: textEntries } = redactText(state.domTree, textDetections);

  // 3. Redact image regions (destructive blur)
  const imageRegions = imageDetections.map((d) => d.location as ImageRegion);
  let redactedImage = null;
  if (state.screenshot && imageRegions.length > 0) {
    redactedImage = await blurImageRegions(state.screenshot, imageRegions);
  }

  // Build image redaction entries
  const imageEntries = imageDetections.map((d, i) => ({
    type: d.type,
    token: `[REDACTED:${d.type}:IMG${i + 1}]`,
    location: d.location as ImageRegion,
    confidence: d.confidence,
  }));

  // 4. CRITICAL: Destroy the original screenshot data
  // This ensures no code path downstream can access raw pixels
  state.screenshot = null;

  // 5. Sanitize the URL (strip query params that might contain PII)
  const sanitizedUrl = sanitizeUrl(state.url);

  // 6. Assemble the RAAP payload
  const payload = createRaapPayload({
    schemeVersion: 'RAAP-1',
    timestamp: Date.now(),
    url: sanitizedUrl,
    graph: redactedTree,
    redactionMap: [...textEntries, ...imageEntries],
    image: redactedImage,
    metrics,
  });

  console.info(
    `[VEIL:${MODULE}] RAAP payload created: ` +
    `${textEntries.length} text redactions, ${imageEntries.length} image redactions`
  );

  return payload;
}

/**
 * Sanitize a URL by stripping potentially PII-containing query parameters.
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Common PII query params to strip
    const piiParams = [
      'email', 'mail', 'phone', 'tel', 'name', 'user', 'username',
      'ssn', 'aadhaar', 'pan', 'password', 'token', 'auth', 'key',
      'secret', 'session', 'sid', 'id',
    ];
    for (const param of piiParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, return a safe generic URL
    return '[URL_REDACTED]';
  }
}
