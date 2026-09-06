/**
 * Action Executor — content script that receives an ActionPlan
 * and performs safe DOM actions (click, fill, scroll).
 *
 * Security boundary:
 * - All actions are validated against the ALLOWED_ACTIONS allowlist
 * - No eval() or arbitrary code execution
 * - Each action is logged with success/failure status
 */

import type { Action, ActionPlan } from '@/types/action';
import { isValidActionType } from '@/types/action';
import type { ExecuteActionsResponse } from '@/types/messages';

const MODULE = 'ActionExecutor';

/** Delay between sequential actions (ms) */
const ACTION_DELAY_MS = 300;

/**
 * Find an element by CSS selector or XPath.
 */
function findElement(selector: string): Element | null {
  // Try CSS selector first
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch {
    // Invalid CSS selector — try XPath
  }

  // Try XPath
  try {
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return result.singleNodeValue as Element | null;
  } catch {
    return null;
  }
}

/**
 * Execute a single action on the page.
 */
async function executeAction(action: Action): Promise<{ success: boolean; error?: string }> {
  // Validate action type against allowlist
  if (!isValidActionType(action.action)) {
    return { success: false, error: `Disallowed action type: ${action.action}` };
  }

  try {
    switch (action.action) {
      case 'click': {
        const el = findElement(action.selector);
        if (!el) return { success: false, error: `Element not found: ${action.selector}` };

        if (el instanceof HTMLElement) {
          el.click();
          console.debug(`[VEIL:${MODULE}] Clicked: ${action.selector}`);
          return { success: true };
        }
        return { success: false, error: 'Element is not clickable' };
      }

      case 'fill': {
        const el = findElement(action.selector);
        if (!el) return { success: false, error: `Element not found: ${action.selector}` };

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // Clear existing value
          el.value = '';

          // Set new value
          el.value = action.value ?? '';

          // Dispatch events to trigger React/Vue/Angular change detection
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));

          console.debug(`[VEIL:${MODULE}] Filled: ${action.selector} = "${action.value}"`);
          return { success: true };
        }
        return { success: false, error: 'Element is not fillable' };
      }

      case 'scroll': {
        const el = findElement(action.selector);
        if (!el) return { success: false, error: `Element not found: ${action.selector}` };

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.debug(`[VEIL:${MODULE}] Scrolled to: ${action.selector}`);
        return { success: true };
      }

      case 'wait': {
        const ms = parseInt(action.value ?? '1000', 10);
        await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10000)));
        console.debug(`[VEIL:${MODULE}] Waited ${ms}ms`);
        return { success: true };
      }

      case 'navigate': {
        // Safety: only allow same-origin navigation
        try {
          const target = new URL(action.value ?? '', window.location.origin);
          if (target.origin !== window.location.origin) {
            return { success: false, error: 'Cross-origin navigation blocked' };
          }
          window.location.href = target.toString();
          console.debug(`[VEIL:${MODULE}] Navigating to: ${target.toString()}`);
          return { success: true };
        } catch {
          return { success: false, error: 'Invalid navigation URL' };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action.action}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute an action plan sequentially with delays between actions.
 */
export async function executeActionPlan(
  plan: ActionPlan,
): Promise<Array<{ action: string; selector: string; success: boolean; error?: string }>> {
  console.info(`[VEIL:${MODULE}] Executing ${plan.actions.length} actions`);

  const results: Array<{ action: string; selector: string; success: boolean; error?: string }> = [];

  for (const action of plan.actions) {
    const result = await executeAction(action);
    results.push({
      action: action.action,
      selector: action.selector,
      ...result,
    });

    if (!result.success) {
      console.warn(`[VEIL:${MODULE}] Action failed: ${action.action} on ${action.selector} — ${result.error}`);
    }

    // Delay between actions for stability
    if (plan.actions.indexOf(action) < plan.actions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, ACTION_DELAY_MS));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.info(`[VEIL:${MODULE}] Execution complete: ${successCount}/${results.length} actions succeeded`);

  return results;
}

// ─── Message Listener ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTIONS') {
    (async () => {
      try {
        const results = await executeActionPlan(message.plan);
        const response: ExecuteActionsResponse = {
          type: 'EXECUTE_ACTIONS_RESULT',
          results,
        };
        sendResponse(response);
      } catch (error) {
        console.error(`[VEIL:${MODULE}] Action execution failed:`, error);
        sendResponse({
          type: 'EXECUTE_ACTIONS_RESULT',
          results: [],
        });
      }
    })();
    return true; // Keep channel open for async
  }
});
