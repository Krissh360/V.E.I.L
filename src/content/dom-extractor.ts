/**
 * DOM Extractor — content script that walks the page DOM and produces
 * a simplified DOMNode[] tree suitable for the detection pipeline.
 *
 * Runs in the content script context (has DOM access).
 * Communicates with the service worker via chrome.runtime message passing.
 */

import type { DOMNode, BoundingRect, ExtractDOMResponse } from '@/types';

const MODULE = 'DOMExtractor';
const MAX_DEPTH = 20;
const MAX_NODES = 8000;
const BATCH_SIZE = 50;

/** Tags to skip entirely — they don't contain meaningful user content */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'link', 'meta', 'head',
  'br', 'hr', 'wbr',
]);

/** Attributes to capture from elements */
const CAPTURE_ATTRS = [
  'type', 'name', 'id', 'placeholder', 'aria-label', 'aria-labelledby',
  'role', 'href', 'src', 'alt', 'value', 'autocomplete', 'for',
  'data-testid', 'title',
];

let nodeCount = 0;

/**
 * Generate a unique XPath for an element.
 */
function getXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}[${index}]`);
    current = current.parentElement;
  }

  return '/html/' + parts.join('/');
}

/**
 * Generate a CSS selector for an element (best-effort unique).
 */
function getCSSSelector(element: Element): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const tag = element.tagName.toLowerCase();
  const name = element.getAttribute('name');
  if (name) {
    return `${tag}[name="${CSS.escape(name)}"]`;
  }

  const type = element.getAttribute('type');
  const placeholder = element.getAttribute('placeholder');
  if (tag === 'input' && type) {
    if (placeholder) {
      return `input[type="${CSS.escape(type)}"][placeholder="${CSS.escape(placeholder)}"]`;
    }
    return `input[type="${CSS.escape(type)}"]`;
  }

  return getXPath(element);
}

/**
 * Get visible bounding rect, returning null if element is not visible.
 */
function getBoundingRect(element: Element): BoundingRect | undefined {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Extract visible text content from a single node (not recursive).
 */
function getDirectText(element: Element): string | undefined {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
    }
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract relevant attributes from an element.
 */
function extractAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of CAPTURE_ATTRS) {
    const value = element.getAttribute(name);
    if (value !== null && value.length > 0) {
      attrs[name] = value;
    }
  }

  // Capture current user-entered value from input, textarea, and select elements
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const currentValue = element.value;
    if (currentValue !== undefined && currentValue !== '') {
      attrs['value'] = currentValue;
    }
  }

  return attrs;
}

/**
 * Recursively walk the DOM and build a DOMNode tree.
 */
function walkElement(element: Element, depth: number): DOMNode | null {
  if (nodeCount >= MAX_NODES) return null;
  if (depth > MAX_DEPTH) return null;

  const tag = element.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return null;

  // Skip hidden elements
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return null;

  nodeCount++;

  const node: DOMNode = {
    tag,
    attributes: extractAttributes(element),
    children: [],
    xpath: getXPath(element),
    cssSelector: getCSSSelector(element),
    textContent: getDirectText(element),
    boundingRect: getBoundingRect(element),
  };

  // Capture ARIA role
  const role = element.getAttribute('role') || element.ariaRoleDescription;
  if (role) node.role = role;

  // Recurse into children
  for (const child of element.children) {
    const childNode = walkElement(child, depth + 1);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  return node;
}

/**
 * Extract the full DOM tree from the current page.
 * Returns a simplified, serializable DOMNode array.
 */
export function extractDOM(): { domTree: DOMNode[]; viewportSize: { width: number; height: number } } {
  nodeCount = 0;
  const root = document.body;
  if (!root) {
    return {
      domTree: [],
      viewportSize: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  const domTree: DOMNode[] = [];
  const rootNode = walkElement(root, 0);
  if (rootNode) {
    domTree.push(rootNode);
  }

  console.debug(`[VEIL:DOMExtractor] Extracted ${nodeCount} nodes`);

  return {
    domTree,
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}

// ─── Active Form Monitoring ──────────────────────────────────────────

async function isVeilActive(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get('isActivated');
    return Boolean(data.isActivated);
  } catch {
    return false;
  }
}

// When VEIL is active, monitor form submit & change events to protect sensitive data
document.addEventListener('submit', async () => {
  const active = await isVeilActive();
  if (active) {
    chrome.runtime.sendMessage({ type: 'START_PIPELINE' }).catch(() => {});
  }
}, true);

let changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
document.addEventListener('change', async () => {
  const active = await isVeilActive();
  if (!active) return;
  if (changeDebounceTimer) clearTimeout(changeDebounceTimer);
  changeDebounceTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'START_PIPELINE' }).catch(() => {});
  }, 600);
}, true);

// ─── Message Listener ────────────────────────────────────────────────
// Listen for EXTRACT_DOM requests from the service worker

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_DOM') {
    try {
      const result = extractDOM();
      const response: ExtractDOMResponse = {
        type: 'EXTRACT_DOM_RESULT',
        ...result,
      };
      sendResponse(response);
    } catch (error) {
      console.error(`[VEIL:${MODULE}] DOM extraction failed:`, error);
      sendResponse({
        type: 'EXTRACT_DOM_RESULT',
        domTree: [],
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
      });
    }
    return false;
  }
});

// Announce readiness to the service worker
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).catch(() => {
  // Service worker may not be listening yet — that's fine
});
