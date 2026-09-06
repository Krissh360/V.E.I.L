/**
 * API Client — the ONLY outbound network function in VEIL.
 *
 * ARCHITECTURAL INVARIANT:
 * This module only accepts RaapV1Payload (branded type).
 * It cannot be called with a raw ScreenState — the TypeScript compiler
 * enforces this at compile time, and the sanitizer guard validates at runtime.
 *
 * No other module in the extension should make outbound HTTP requests
 * carrying page data.
 */

import type { RaapV1Payload } from '@/types/raap';
import type { ActionPlan } from '@/types/action';
import { assertNoPIILeaked } from './sanitizer-guard';

const MODULE = 'ApiClient';

/** Default server URL — local-only for Phase 1 */
const DEFAULT_SERVER_URL = 'http://localhost:8000';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30_000;

/** Max retries on network failure */
const MAX_RETRIES = 2;

export interface ApiClientConfig {
  serverUrl?: string;
  timeoutMs?: number;
}

/**
 * Send a RAAP v1 payload to the reasoning server and get an action plan back.
 *
 * This is the ONLY function that transmits data off-device.
 * It enforces:
 * 1. Compile-time: only RaapV1Payload type accepted (branded)
 * 2. Runtime: sanitizer guard scans for leaked PII before sending
 *
 * @param payload - The branded RAAP v1 payload (must come from VEIL filter)
 * @param config - Optional configuration overrides
 * @returns The action plan from the reasoning server
 */
export async function sendToReasoningServer(
  payload: RaapV1Payload,
  config: ApiClientConfig = {},
): Promise<ActionPlan> {
  const serverUrl = config.serverUrl ?? DEFAULT_SERVER_URL;
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // Runtime check: verify this is actually a RAAP payload
  if (payload.schemeVersion !== 'RAAP-1') {
    throw new Error(`[VEIL:${MODULE}] Invalid payload: missing RAAP-1 scheme version`);
  }

  // Serialize the payload
  const jsonString = JSON.stringify(payload);

  // RUNTIME SAFETY CHECK: scan the serialized JSON for any leaked PII
  // This is the belt-and-suspenders defense — even if the VEIL filter
  // has a bug, this catches it before transmission.
  assertNoPIILeaked(jsonString);

  console.info(`[VEIL:${MODULE}] Sending RAAP payload to ${serverUrl}/reason (${jsonString.length} bytes)`);

  // Send with retry logic
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${serverUrl}/reason`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VEIL-Version': '0.1.0',
          'X-RAAP-Version': 'RAAP-1',
        },
        body: jsonString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const actionPlan = (await response.json()) as ActionPlan;

      console.info(
        `[VEIL:${MODULE}] Received action plan: ${actionPlan.actions.length} actions ` +
        `(confidence: ${actionPlan.confidence})`
      );

      return actionPlan;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[VEIL:${MODULE}] Request timed out (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      } else {
        console.warn(`[VEIL:${MODULE}] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
      }

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `[VEIL:${MODULE}] All ${MAX_RETRIES + 1} attempts failed. Last error: ${lastError?.message}`
  );
}

/**
 * Check if the reasoning server is reachable.
 */
export async function checkServerHealth(serverUrl?: string): Promise<boolean> {
  const url = serverUrl ?? DEFAULT_SERVER_URL;
  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
