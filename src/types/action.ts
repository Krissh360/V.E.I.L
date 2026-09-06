/**
 * Action types — what the reasoning server tells the extension to do.
 * All actions are validated against an allowlist before execution.
 */

/** Permitted action types — never eval or execute arbitrary instructions */
export const ALLOWED_ACTIONS = ['click', 'fill', 'scroll', 'wait', 'navigate'] as const;
export type ActionType = typeof ALLOWED_ACTIONS[number];

/** A single action to perform on the page */
export interface Action {
  /** What to do */
  action: ActionType;
  /** CSS selector or XPath targeting the element */
  selector: string;
  /** Value for 'fill' actions */
  value?: string;
  /** Human-readable description of intent */
  description?: string;
}

/** The complete action plan returned by the reasoning server */
export interface ActionPlan {
  /** Ordered list of actions to execute */
  actions: Action[];
  /** Reasoning trace (Phase 2: from VLM) */
  reasoning?: string;
  /** Overall confidence 0–1 */
  confidence: number;
}

/** Type guard: is this a valid action type? */
export function isValidActionType(type: string): type is ActionType {
  return (ALLOWED_ACTIONS as readonly string[]).includes(type);
}
