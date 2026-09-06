/**
 * ScreenState — the raw, unredacted snapshot of a browser tab.
 *
 * ⚠️ PRIVACY CRITICAL: This object contains raw pixels and unredacted text.
 * It must NEVER leave the device. Only the VEIL filter may consume it,
 * and it must be destroyed after producing a RaapV1Payload.
 */

/** Bounding rectangle in viewport coordinates */
export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Simplified DOM node for the accessibility/DOM tree representation */
export interface DOMNode {
  /** HTML tag name (lowercase) */
  tag: string;
  /** ARIA role if present */
  role?: string;
  /** Key-value attribute map (e.g., type, name, placeholder, aria-label) */
  attributes: Record<string, string>;
  /** Visible text content of this node (not children) */
  textContent?: string;
  /** Child nodes */
  children: DOMNode[];
  /** Unique XPath for targeting this element */
  xpath: string;
  /** CSS selector that uniquely identifies this element */
  cssSelector?: string;
  /** Bounding rect in viewport coordinates */
  boundingRect?: BoundingRect;
}

/**
 * The complete raw state of a tab at a point in time.
 * Contains raw pixels and unredacted DOM — NEVER transmit off-device.
 */
export interface ScreenState {
  /** Chrome tab ID */
  tabId: number;
  /** Page URL */
  url: string;
  /** Capture timestamp (Date.now()) */
  timestamp: number;
  /** Screenshot as base64 data URL — raw pixels, MUST be destroyed after redaction */
  screenshot: string | null;
  /** Simplified DOM/accessibility tree */
  domTree: DOMNode[];
  /** Viewport dimensions */
  viewportSize: {
    width: number;
    height: number;
  };
}
