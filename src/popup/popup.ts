/**
 * VEIL Popup — UI controller for the extension popup.
 * Handles the activation toggle, scanning, pipeline status, and results display.
 */

import type { PipelineCompleteMessage } from '@/types/messages';

const MODULE = 'Popup';

// ─── DOM Elements ────────────────────────────────────────────────────

const activateBtn = document.getElementById('activate-btn') as HTMLButtonElement;
const activateBtnText = document.getElementById('activate-btn-text') as HTMLElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const protectionDot = document.getElementById('protection-dot') as HTMLElement;
const protectionTitle = document.getElementById('protection-title') as HTMLElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const pipelineSection = document.getElementById('pipeline-section') as HTMLElement;
const resultsSection = document.getElementById('results-section') as HTMLElement;
const detectionGrid = document.getElementById('detection-grid') as HTMLElement;
const metricsGrid = document.getElementById('metrics-grid') as HTMLElement;
const actionList = document.getElementById('action-list') as HTMLElement;
const payloadPreview = document.getElementById('payload-preview') as HTMLElement;
const payloadToggle = document.getElementById('payload-toggle') as HTMLElement;
const overviewTab = document.getElementById('overview-tab') as HTMLButtonElement;
const judgeTab = document.getElementById('judge-tab') as HTMLButtonElement;
const overviewView = document.getElementById('overview-view') as HTMLElement;
const judgeView = document.getElementById('judge-view') as HTMLElement;
const judgeValues = document.getElementById('judge-values') as HTMLElement;
const judgePayload = document.getElementById('judge-payload') as HTMLElement;
const judgeFace = document.getElementById('judge-face') as HTMLCanvasElement;

let isVeilActive = false;
let lastJudgeResult: PipelineCompleteMessage | null = null;

function showJudgeView(show: boolean): void {
  overviewView.style.display = show ? 'none' : 'block';
  judgeView.style.display = show ? 'flex' : 'none';
  overviewTab.classList.toggle('active', !show);
  judgeTab.classList.toggle('active', show);
  if (show && lastJudgeResult && !lastJudgeResult.judgeEvidence?.screenshotDataUrl) {
    void recoverJudgeEvidence(lastJudgeResult);
  }
}

/**
 * Older persisted pipeline results intentionally lack the local-only preview
 * data. Rebuild it from the active page when that happens, without involving
 * the network or altering the RAAP payload.
 */
async function recoverJudgeEvidence(result: PipelineCompleteMessage): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [capture, probe] = await Promise.all([
      chrome.tabs.captureVisibleTab({ format: 'png' }),
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const photo = [...document.images].find((image) => /face photo|identity photo|profile photo/i.test(image.alt));
          const rect = photo?.getBoundingClientRect();
          return {
            values: {
              AADHAAR: (document.querySelector('input[name="aadhaar"], input[id*="aadhaar" i]') as HTMLInputElement | null)?.value,
              PASSWORD: (document.querySelector('input[name*="password" i], input[id*="password" i]') as HTMLInputElement | null)?.value,
            },
            faceBounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
            viewportSize: { width: window.innerWidth, height: window.innerHeight },
          };
        },
      }),
    ]);
    const local = probe[0]?.result;
    if (!local) return;
    result.judgeEvidence = {
      values: local.values,
      faceBounds: local.faceBounds,
      screenshotDataUrl: capture,
      viewportSize: local.viewportSize,
    };
    updateJudgeView(result);
  } catch (error) {
    console.warn(`[VEIL:${MODULE}] Could not recover local Judge View evidence:`, error);
  }
}

function drawLocalFace(result: PipelineCompleteMessage): void {
  const ctx = judgeFace.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#13100e'; ctx.fillRect(0, 0, judgeFace.width, judgeFace.height);
  const evidence = result.judgeEvidence;
  if (!evidence?.screenshotDataUrl || !evidence.faceBounds) {
    ctx.strokeStyle = '#A9842E'; ctx.strokeRect(12, 12, 96, 96); ctx.fillStyle = '#E7E1D3';
    ctx.fillText('FACE DETECTED', 20, 64); return;
  }
  const image = new Image();
  image.onload = () => {
    const scaleX = image.width / evidence.viewportSize.width;
    const scaleY = image.height / evidence.viewportSize.height;
    const b = evidence.faceBounds!;
    ctx.drawImage(image, b.x * scaleX, b.y * scaleY, b.width * scaleX, b.height * scaleY, 0, 0, 120, 120);
    ctx.strokeStyle = '#A9842E'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 116, 116);
  };
  image.src = evidence.screenshotDataUrl;
}

function updateJudgeView(result: PipelineCompleteMessage): void {
  const values = result.judgeEvidence?.values ?? {};
  judgeValues.innerHTML = [
    ['Aadhaar', values.AADHAAR ?? 'Detected locally'],
    ['Password', values.PASSWORD ?? 'Detected locally'],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  drawLocalFace(result);
  // The payload itself is the exact serialized object handed to the API
  // client—no mocked example or reconstructed graph is used here.
  judgePayload.textContent = JSON.stringify(result.payload, null, 2);
}

// ─── Server Health Check ─────────────────────────────────────────────

async function checkServer(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8000/health', {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Server online';
      return true;
    }
  } catch {
    // Server not reachable
  }
  statusDot.className = 'status-dot disconnected';
  statusText.textContent = 'Server offline';
  return false;
}

// ─── Active State UI Updates ─────────────────────────────────────────

function updateActiveUI(active: boolean): void {
  isVeilActive = active;
  if (active) {
    protectionDot.className = 'protection-dot active';
    protectionTitle.textContent = 'Protection active';
    toggleBtn.textContent = 'Turn off';
    activateBtnText.textContent = 'Scan page';
  } else {
    protectionDot.className = 'protection-dot';
    protectionTitle.textContent = 'Protection inactive';
    toggleBtn.textContent = 'Turn on';
    activateBtnText.textContent = 'Turn on protection';
  }
}

// ─── Pipeline Stage UI Updates ───────────────────────────────────────

const STAGE_ORDER = [
  'capture', 'dom_extract', 'text_detect', 'face_detect',
  'redaction', 'network', 'action_execute',
];

function resetPipelineUI(): void {
  pipelineSection.style.display = 'block';
  pipelineSection.classList.add('pipeline-running');
  resultsSection.style.display = 'none';

  for (const stage of STAGE_ORDER) {
    const stageEl = document.getElementById(`stage-${stage}`);
    const statusEl = document.getElementById(`stage-${stage}-status`);
    if (stageEl) stageEl.className = 'stage';
    if (statusEl) statusEl.textContent = '—';
  }
}

function markStageActive(stage: string): void {
  const stageEl = document.getElementById(`stage-${stage}`);
  if (stageEl) stageEl.className = 'stage active';
}

function markStageComplete(stage: string, durationMs?: number): void {
  const stageEl = document.getElementById(`stage-${stage}`);
  const statusEl = document.getElementById(`stage-${stage}-status`);
  if (stageEl) stageEl.className = 'stage completed';
  if (statusEl && durationMs !== undefined) {
    statusEl.textContent = `${durationMs}ms`;
  } else if (statusEl) {
    statusEl.textContent = '✓';
  }
}

function markStageError(stage: string): void {
  const stageEl = document.getElementById(`stage-${stage}`);
  const statusEl = document.getElementById(`stage-${stage}-status`);
  if (stageEl) stageEl.className = 'stage error';
  if (statusEl) statusEl.textContent = '✗';
}

// ─── Results Display ─────────────────────────────────────────────────

function showResults(result: PipelineCompleteMessage): void {
  lastJudgeResult = result;
  resultsSection.style.display = 'flex';

  // Detection counts
  detectionGrid.innerHTML = '';
  const counts = result.metrics.detectionCounts;
  if (Object.keys(counts).length === 0) {
    detectionGrid.innerHTML = '<div style="color: var(--veil-ink-dim); font-size: 11px;">No sensitive information detected</div>';
  } else {
    for (const [type, count] of Object.entries(counts)) {
      const item = document.createElement('div');
      item.className = 'detection-item';
      item.innerHTML = `
        <span class="detection-count">${count}</span>
        <span class="detection-type">${formatDetectionType(type)}</span>
      `;
      detectionGrid.appendChild(item);
    }
  }

  // Metrics
  metricsGrid.innerHTML = '';
  const timings = result.metrics.timings;
  for (const [stage, ms] of Object.entries(timings)) {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `
      <span class="metric-name">${formatStageName(stage)}</span>
      <span class="metric-value">${ms}ms</span>
    `;
    metricsGrid.appendChild(row);
  }

  // Total time
  const totalMs = Object.values(timings).reduce((sum, ms) => sum + (ms as number), 0);
  const totalRow = document.createElement('div');
  totalRow.className = 'metric-row';
  totalRow.innerHTML = `
    <span class="metric-name" style="font-weight: 600;">Total</span>
    <span class="metric-value" style="color: var(--veil-gold); font-weight: 600;">${totalMs}ms</span>
  `;
  metricsGrid.appendChild(totalRow);

  // Actions
  actionList.innerHTML = '';
  if (result.actionPlan && result.actionPlan.actions.length > 0) {
    result.actionPlan.actions.forEach((action, i) => {
      const actionResult = result.actionResults?.[i];
      const item = document.createElement('div');
      item.className = 'action-item';
      item.innerHTML = `
        <span class="action-type">${formatActionType(action.action)}</span>
        <span class="action-selector" title="${action.selector}">${action.selector}</span>
        ${actionResult ? `<span class="action-result ${actionResult.success ? 'success' : 'failure'}">${actionResult.success ? '✓' : '✗'}</span>` : ''}
      `;
      actionList.appendChild(item);
    });
  } else {
    actionList.innerHTML = '<div style="color: var(--veil-ink-dim); font-size: 11px;">No actions generated</div>';
  }

  // Payload preview (sanitized — exclude image data URL to keep it readable)
  const payloadCopy = { ...result.payload, image: result.payload.image ? { ...result.payload.image, dataUrl: '[BASE64_OMITTED]' } : null };
  payloadPreview.textContent = JSON.stringify(payloadCopy, null, 2);
  updateJudgeView(result);
  if (!result.judgeEvidence?.screenshotDataUrl) void recoverJudgeEvidence(result);
}

function formatStageName(stage: string): string {
  const names: Record<string, string> = {
    capture: 'Page capture',
    dom_extract: 'Page structure',
    text_detect: 'Text scan',
    face_detect: 'Face scan',
    redaction: 'Redaction',
    network: 'Reasoning',
    action_execute: 'Actions',
  };
  return names[stage] ?? stage;
}

function formatDetectionType(type: string): string {
  return type.toLowerCase().replace(/_/g, ' ');
}

function formatActionType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

// ─── Execute Pipeline Execution ───────────────────────────────────────

async function executePipeline(isAuto = false): Promise<void> {
  activateBtn.disabled = true;
  activateBtn.className = 'action-btn primary-btn running';
  activateBtn.innerHTML = '<span>Scanning page...</span>';

  resetPipelineUI();

  for (const stage of STAGE_ORDER) {
    markStageActive(stage);
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: 'START_PIPELINE' }) as PipelineCompleteMessage;

    if (result && result.type === 'PIPELINE_COMPLETE') {
      updateActiveUI(true);

      for (const [stage, ms] of Object.entries(result.metrics.timings)) {
        markStageComplete(stage, ms as number);
      }

      for (const stage of STAGE_ORDER) {
        if (!(stage in result.metrics.timings)) {
          markStageComplete(stage);
        }
      }

      showResults(result);
      pipelineSection.classList.remove('pipeline-running');

      activateBtn.className = 'action-btn primary-btn completed';
      activateBtn.innerHTML = '<span>Scan complete</span>';
    } else if (result && 'error' in result) {
      throw new Error((result as { error: string }).error);
    }
  } catch (error) {
    console.error(`[VEIL:${MODULE}] Pipeline failed:`, error);
    activateBtn.className = 'action-btn primary-btn error';
    activateBtn.innerHTML = `<span>Scan failed: ${error instanceof Error ? error.message : 'Please try again'}</span>`;
    pipelineSection.classList.remove('pipeline-running');

    for (const stage of STAGE_ORDER) {
      const stageEl = document.getElementById(`stage-${stage}`);
      if (stageEl && !stageEl.classList.contains('completed')) {
        markStageError(stage);
      }
    }
  }

  setTimeout(() => {
    activateBtn.disabled = false;
    activateBtn.className = 'action-btn primary-btn';
    activateBtn.innerHTML = `<span id="activate-btn-text">${isVeilActive ? 'Scan page' : 'Turn on protection'}</span>`;
  }, isAuto ? 1500 : 2500);
}

// ─── Event Handlers ──────────────────────────────────────────────────

activateBtn.addEventListener('click', () => {
  executePipeline(false);
});

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_ACTIVATION',
      active: !isVeilActive,
    }) as { isActivated: boolean; result?: PipelineCompleteMessage };

    const newActive = Boolean(response?.isActivated);
    updateActiveUI(newActive);

    if (newActive && response.result) {
      showResults(response.result);
      pipelineSection.style.display = 'block';
      for (const [stage, ms] of Object.entries(response.result.metrics.timings)) {
        markStageComplete(stage, ms as number);
      }
    } else if (!newActive) {
      pipelineSection.style.display = 'none';
      resultsSection.style.display = 'none';
    }
  } catch (err) {
    console.warn(`[VEIL:${MODULE}] Toggle failed:`, err);
  } finally {
    toggleBtn.disabled = false;
  }
});

payloadToggle.addEventListener('click', () => {
  const isVisible = payloadPreview.style.display !== 'none';
  payloadPreview.style.display = isVisible ? 'none' : 'block';
  const icon = payloadToggle.querySelector('.toggle-icon');
  if (icon) icon.className = `toggle-icon ${isVisible ? '' : 'open'}`;
});

overviewTab.addEventListener('click', () => showJudgeView(false));
judgeTab.addEventListener('click', () => showJudgeView(true));

// ─── Initialize Popup ────────────────────────────────────────────────

async function initPopup(): Promise<void> {
  await checkServer();

  try {
    const { isActivated = false, lastResult = null } = await chrome.storage.local.get([
      'isActivated',
      'lastResult',
    ]);

    updateActiveUI(isActivated);

    if (isActivated && lastResult) {
      // Restore previous state immediately
      pipelineSection.style.display = 'block';
      for (const [stage, ms] of Object.entries(lastResult.metrics.timings)) {
        markStageComplete(stage, ms as number);
      }
      for (const stage of STAGE_ORDER) {
        if (!(stage in lastResult.metrics.timings)) {
          markStageComplete(stage);
        }
      }
      showResults(lastResult);

      // Perform a seamless automatic refresh of current tab state
      executePipeline(true);
    }
  } catch (err) {
    console.warn(`[VEIL:${MODULE}] Init failed:`, err);
  }
}

initPopup();
