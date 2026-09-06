/**
 * Redaction Overlay — content script that displays visual feedback
 * showing where PII was detected and redacted.
 *
 * Uses Shadow DOM to isolate styles from the host page.
 */

import type { Detection, ImageRegion, DOMLocation } from '@/types/detection';

const MODULE = 'Overlay';
const OVERLAY_ID = 'veil-redaction-overlay';
const AUTO_HIDE_MS = 10_000; // Auto-hide after 10 seconds

let overlayRoot: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Create or get the overlay container with Shadow DOM isolation.
 */
function getOverlayContainer(): { host: HTMLElement; shadow: ShadowRoot } {
  let host = document.getElementById(OVERLAY_ID);
  if (host && overlayRoot && shadowRoot) {
    return { host, shadow: shadowRoot };
  }

  // Create new overlay host
  host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
  `;

  const shadow = host.attachShadow({ mode: 'closed' });

  // Inject overlay styles
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }

    .veil-badge {
      position: absolute;
      background: rgba(220, 38, 38, 0.85);
      color: white;
      font-family: 'Inter', 'SF Pro', -apple-system, sans-serif;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.5px;
      pointer-events: none;
      animation: veil-fade-in 0.3s ease-out;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
    }

    .veil-blur-region {
      position: absolute;
      backdrop-filter: blur(20px);
      background: rgba(128, 128, 128, 0.2);
      border: 2px solid rgba(220, 38, 38, 0.5);
      border-radius: 4px;
      pointer-events: none;
      animation: veil-fade-in 0.3s ease-out;
    }

    .veil-status-bar {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: #18181b;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      padding: 8px 16px;
      border-radius: 8px;
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.15);
      animation: veil-slide-up 0.4s ease-out;
    }

    .veil-status-bar:hover {
      background: #27272a;
    }

    .veil-shield-icon {
      width: 16px;
      height: 16px;
      background: #27272a;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }

    @keyframes veil-fade-in {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes veil-slide-up {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes veil-fade-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  shadow.appendChild(style);

  document.body.appendChild(host);
  overlayRoot = host;
  shadowRoot = shadow;

  return { host, shadow };
}

/**
 * Show redaction markers for detected PII.
 */
export function showRedactionOverlay(detections: Detection[]): void {
  const { shadow } = getOverlayContainer();

  // Clear existing markers (keep style element)
  const style = shadow.querySelector('style');
  shadow.innerHTML = '';
  if (style) shadow.appendChild(style);

  let markerCount = 0;

  for (const detection of detections) {
    if (detection.location.kind === 'image') {
      // Image region: show blur overlay
      const region = detection.location as ImageRegion;
      const blurDiv = document.createElement('div');
      blurDiv.className = 'veil-blur-region';
      blurDiv.style.left = `${region.x}px`;
      blurDiv.style.top = `${region.y}px`;
      blurDiv.style.width = `${region.width}px`;
      blurDiv.style.height = `${region.height}px`;
      shadow.appendChild(blurDiv);

      // Badge on the blur region
      const badge = document.createElement('div');
      badge.className = 'veil-badge';
      badge.textContent = `🛡 ${detection.type}`;
      badge.style.left = `${region.x}px`;
      badge.style.top = `${region.y - 18}px`;
      shadow.appendChild(badge);
      markerCount++;
    } else if (detection.location.kind === 'dom') {
      // DOM location: try to find the element and overlay a badge
      const loc = detection.location as DOMLocation;
      const selector = loc.cssSelector ?? loc.xpath;

      try {
        let element: Element | null = null;
        try {
          element = document.querySelector(selector);
        } catch {
          // Try XPath
          const result = document.evaluate(
            loc.xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          element = result.singleNodeValue as Element | null;
        }

        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const badge = document.createElement('div');
            badge.className = 'veil-badge';
            badge.textContent = `🛡 ${detection.type}`;
            badge.style.left = `${rect.right + 4}px`;
            badge.style.top = `${rect.top}px`;
            shadow.appendChild(badge);
            markerCount++;
          }
        }
      } catch {
        // Element not found — skip overlay for this detection
      }
    }
  }

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.className = 'veil-status-bar';
  statusBar.innerHTML = `
    <div class="veil-shield-icon">🛡</div>
    <span>VEIL protected ${detections.length} item${detections.length !== 1 ? 's' : ''}</span>
  `;
  statusBar.addEventListener('click', () => hideRedactionOverlay());
  shadow.appendChild(statusBar);

  console.debug(`[VEIL:${MODULE}] Showing ${markerCount} redaction markers`);

  // Auto-hide after timeout
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => hideRedactionOverlay(), AUTO_HIDE_MS);
}

/**
 * Hide and remove the redaction overlay.
 */
export function hideRedactionOverlay(): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  const host = document.getElementById(OVERLAY_ID);
  if (host) {
    host.style.animation = 'veil-fade-out 0.3s ease-out';
    setTimeout(() => host.remove(), 300);
    overlayRoot = null;
    shadowRoot = null;
  }
}

// ─── Message Listener ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHOW_OVERLAY') {
    showRedactionOverlay(message.detections);
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'HIDE_OVERLAY') {
    hideRedactionOverlay();
    sendResponse({ success: true });
    return true;
  }
});
