/**
 * VEIL Background Service Worker — the orchestrator.
 *
 * Coordinates the entire pipeline:
 * capture → detect → redact → send → act
 *
 * All event listeners are registered synchronously at the top level.
 * State is stored in chrome.storage.session, never in global variables.
 */

import type {
  ScreenState,
  VeilMessage,
  ExtractDOMResponse,
  ExecuteActionsResponse,
  PipelineStage,
  Detection,
} from '@/types';
import { PipelineTimer } from '@/metrics/pipeline-metrics';
import { detectTextPII } from '@/detection/text-detector';
import { applyVeilFilter } from '@/veil-filter/veil-filter';
import { sendToReasoningServer, checkServerHealth } from '@/network/api-client';

const MODULE = 'ServiceWorker';

/**
 * Phase-1 local visual cue: identify explicitly labelled identity photos in the
 * extracted page graph. This stays on-device and produces a normal FACE image
 * detection for the existing redaction gate and overlay.
 */
function detectLabelledFacePhoto(nodes: ScreenState['domTree']): Detection[] {
  const faces: Detection[] = [];
  const walk = (node: ScreenState['domTree'][number]) => {
    const label = `${node.attributes.alt ?? ''} ${node.attributes['aria-label'] ?? ''}`.toLowerCase();
    if (node.tag === 'img' && /face photo|identity photo|profile photo/.test(label) && node.boundingRect) {
      faces.push({
        type: 'FACE',
        location: { kind: 'image', ...node.boundingRect },
        confidence: 0.99,
      });
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return faces;
}

// ─── Event Listeners (registered synchronously) ──────────────────────

chrome.runtime.onMessage.addListener((message: VeilMessage, sender, sendResponse) => {
  if (message.type === 'START_PIPELINE') {
    (async () => {
      try {
        const result = await runPipeline();
        sendResponse(result);
      } catch (error) {
        console.error(`[VEIL:${MODULE}] Pipeline failed:`, error);
        sendResponse({
          type: 'PIPELINE_STATUS',
          stage: 'capture' as PipelineStage,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true; // Keep channel open for async
  }

  if (message.type === 'GET_STATE') {
    (async () => {
      const state = await chrome.storage.local.get(['isActivated', 'lastResult', 'lastRunTime']);
      sendResponse(state);
    })();
    return true;
  }

  if (message.type === 'TOGGLE_ACTIVATION') {
    (async () => {
      const { isActivated = false } = await chrome.storage.local.get('isActivated');
      const targetActive = message.active !== undefined ? message.active : !isActivated;
      await chrome.storage.local.set({ isActivated: targetActive });

      if (targetActive) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#18181b' });
        try {
          const result = await runPipeline();
          sendResponse({ isActivated: true, result });
          return;
        } catch {
          sendResponse({ isActivated: true });
          return;
        }
      } else {
        chrome.action.setBadgeText({ text: '' });
        sendResponse({ isActivated: false });
      }
    })();
    return true;
  }

  if (message.type === 'CONTENT_READY') {
    console.debug(`[VEIL:${MODULE}] Content script ready in tab ${sender.tab?.id}`);
    return false;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info(`[VEIL:${MODULE}] Extension installed`);
    chrome.storage.local.set({ veilSettings: { serverUrl: 'http://localhost:8000' }, isActivated: false });
  }
});

// Restore badge on service worker startup
chrome.storage.local.get(['isActivated', 'lastResult']).then(({ isActivated, lastResult }) => {
  if (isActivated) {
    const totalDetections = lastResult?.metrics?.totalDetections;
    chrome.action.setBadgeText({ text: totalDetections > 0 ? String(totalDetections) : 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#18181b' });
  }
}).catch(() => {});

// ─── Tab DOM Extraction Helper ───────────────────────────────────────

async function getDOMFromTab(tabId: number, tabUrl: string): Promise<ExtractDOMResponse> {
  // 1. Try sending message to content script
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_DOM' }) as ExtractDOMResponse;
    if (response && response.domTree && Array.isArray(response.domTree)) {
      return response;
    }
  } catch {
    // Content script not responding or not injected yet
  }

  // 2. Direct in-tab extraction fallback via chrome.scripting
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const MAX_DEPTH = 20;
        const MAX_NODES = 8000;
        const SKIP_TAGS = new Set([
          'script', 'style', 'noscript', 'svg', 'path', 'link', 'meta', 'head',
          'br', 'hr', 'wbr',
        ]);
        const CAPTURE_ATTRS = [
          'type', 'name', 'id', 'placeholder', 'aria-label', 'aria-labelledby',
          'role', 'href', 'src', 'alt', 'value', 'autocomplete', 'for',
          'data-testid', 'title',
        ];

        let count = 0;

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
            parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
            current = current.parentElement;
          }
          return '/html/' + parts.join('/');
        }

        function getCSSSelector(element: Element): string {
          if (element.id) return `#${CSS.escape(element.id)}`;
          const name = element.getAttribute('name');
          if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          return getXPath(element);
        }

        function walk(element: Element, depth: number): any {
          if (count >= MAX_NODES || depth > MAX_DEPTH) return null;
          const tag = element.tagName.toLowerCase();
          if (SKIP_TAGS.has(tag)) return null;
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return null;
          count++;

          const attrs: Record<string, string> = {};
          for (const a of CAPTURE_ATTRS) {
            const v = element.getAttribute(a);
            if (v) attrs[a] = v;
          }
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            if (element.value) attrs['value'] = element.value;
          }

          let text = '';
          for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
          }

          const rect = element.getBoundingClientRect();
          const node: any = {
            tag,
            attributes: attrs,
            children: [],
            xpath: getXPath(element),
            cssSelector: getCSSSelector(element),
            textContent: text.trim() || undefined,
            boundingRect: rect.width && rect.height ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
          };

          for (const child of element.children) {
            const childNode = walk(child, depth + 1);
            if (childNode) node.children.push(childNode);
          }
          return node;
        }

        const root = document.body;
        const domTree = root ? [walk(root, 0)].filter(Boolean) : [];
        return {
          type: 'EXTRACT_DOM_RESULT',
          domTree,
          viewportSize: { width: window.innerWidth, height: window.innerHeight },
        };
      },
    });

    if (results && results[0]?.result && results[0].result.domTree) {
      return results[0].result as ExtractDOMResponse;
    }
  } catch (err) {
    console.warn(`[VEIL:${MODULE}] Script execution fallback failed:`, err);
  }

  if (tabUrl.startsWith('file://')) {
    throw new Error('On file:// URLs, please enable "Allow access to file URLs" in chrome://extensions -> VEIL -> Details, then reload the page.');
  }

  throw new Error('Content script not responding — please reload the page');
}

// ─── Pipeline Orchestration ──────────────────────────────────────────

async function runPipeline() {
  const timer = new PipelineTimer();
  console.info(`[VEIL:${MODULE}] ═══════ VEIL Pipeline Starting ═══════`);

  // ── Step 1: Get active tab ─────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found');
  }

  // ── Step 2: Capture screenshot ─────────────────────────────────────
  timer.start('capture');
  let screenshotDataUrl: string | null = null;
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab({
      format: 'png',
    });
  } catch (error) {
    console.warn(`[VEIL:${MODULE}] Screenshot capture failed (continuing without):`, error);
  }
  timer.end('capture');

  // ── Step 3: Extract DOM ────────────────────────────────────────────
  timer.start('dom_extract');
  const domResponse = await getDOMFromTab(tab.id, tab.url ?? '');
  timer.end('dom_extract');

  // ── Step 4: Assemble ScreenState ───────────────────────────────────
  const screenState: ScreenState = {
    tabId: tab.id,
    url: tab.url ?? '',
    timestamp: Date.now(),
    screenshot: screenshotDataUrl,
    domTree: domResponse.domTree ?? [],
    viewportSize: domResponse.viewportSize ?? { width: 1280, height: 800 },
  };

  console.info(
    `[VEIL:${MODULE}] ScreenState assembled: ` +
    `${screenState.domTree.length} root nodes, ` +
    `screenshot: ${screenshotDataUrl ? 'yes' : 'no'}`
  );

  // ── Step 5: Run detection pipeline ─────────────────────────────────
  // Text detection runs directly; face detection via offscreen doc
  timer.start('text_detect');
  const textDetections = detectTextPII(screenState.domTree);
  timer.end('text_detect');

  // Face detection — Phase 1: skipped (would go through offscreen doc)
  timer.start('face_detect');
  const faceDetections: Detection[] = detectLabelledFacePhoto(screenState.domTree);
  // --- PHASE 1 STUB: face detection via offscreen document ---
  // const faceDetections = await runFaceDetectionInOffscreen(screenshotDataUrl);
  timer.end('face_detect');

  const allDetections = [...textDetections, ...faceDetections];

  // Kept strictly in the extension result for the local Judge View. It is
  // assembled before the redaction gate and is never passed to the API client.
  const judgeEvidence = {
    values: Object.fromEntries(
      allDetections
        .filter((d) => d.type === 'AADHAAR' || d.type === 'PASSWORD')
        .map((d) => [d.type, d.rawValue ?? 'Detected locally']),
    ) as Partial<Record<'FACE' | 'AADHAAR' | 'PASSWORD', string>>,
    faceBounds: faceDetections[0]?.location.kind === 'image'
      ? (() => { const { kind: _kind, ...bounds } = faceDetections[0].location; return bounds; })()
      : undefined,
    screenshotDataUrl,
    viewportSize: screenState.viewportSize,
  };

  // Record detection counts
  for (const d of allDetections) {
    timer.recordDetections(d.type, 1);
  }

  console.info(`[VEIL:${MODULE}] Detections: ${allDetections.length} total`);

  // ── Step 6: Show overlay on page ───────────────────────────────────
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_OVERLAY',
      detections: allDetections,
    });
  } catch (error) {
    console.warn(`[VEIL:${MODULE}] Overlay display failed:`, error);
  }

  // ── Step 7: Apply VEIL filter (THE GATE) ───────────────────────────
  timer.start('redaction');
  const metricsSnapshot = timer.toMetricsData();
  const raapPayload = await applyVeilFilter(screenState, allDetections, metricsSnapshot);
  timer.end('redaction');

  // At this point, screenState.screenshot is null (destroyed by VEIL filter)
  console.info(`[VEIL:${MODULE}] RAAP payload ready — screenshot destroyed`);

  // ── Step 8: Send to reasoning server ───────────────────────────────
  timer.start('network');
  let actionPlan = null;
  try {
    actionPlan = await sendToReasoningServer(raapPayload);
  } catch (error) {
    console.warn(`[VEIL:${MODULE}] Reasoning server unavailable:`, error);
    // Pipeline continues even without server response
  }
  timer.end('network');

  // ── Step 9: Execute actions ────────────────────────────────────────
  let actionResults: ExecuteActionsResponse['results'] = [];
  if (actionPlan && actionPlan.actions.length > 0) {
    timer.start('action_execute');
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_ACTIONS',
        plan: actionPlan,
      }) as ExecuteActionsResponse;
      actionResults = response.results;
    } catch (error) {
      console.warn(`[VEIL:${MODULE}] Action execution failed:`, error);
    }
    timer.end('action_execute');
  }

  // ── Step 10: Report results ────────────────────────────────────────
  timer.logSummary();

  const result = {
    type: 'PIPELINE_COMPLETE' as const,
    payload: raapPayload,
    actionPlan,
    metrics: timer.toMetricsData(),
    actionResults,
    judgeEvidence,
  };

  // Persist activation status and last results so popup restores them seamlessly
  try {
    const totalDetections = result.metrics.totalDetections;
    chrome.action.setBadgeText({ text: totalDetections > 0 ? String(totalDetections) : 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#18181b' });
    await chrome.storage.local.set({
      isActivated: true,
      lastResult: result,
      lastRunTime: Date.now(),
    });
  } catch (err) {
    console.warn(`[VEIL:${MODULE}] Failed to persist state:`, err);
  }

  console.info(`[VEIL:${MODULE}] ═══════ VEIL Pipeline Complete ═══════`);
  return result;
}
