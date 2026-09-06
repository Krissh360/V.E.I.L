/**
 * Chrome message protocol — typed discriminated union for all
 * inter-context communication (service worker ↔ content script ↔ popup ↔ offscreen).
 */

import type { DOMNode } from './screen-state';
import type { Detection } from './detection';
import type { RaapV1Payload, PipelineMetricsData } from './raap';
import type { ActionPlan } from './action';

// ─── Content Script Messages ─────────────────────────────────────────

export interface ExtractDOMRequest {
  type: 'EXTRACT_DOM';
}

export interface ExtractDOMResponse {
  type: 'EXTRACT_DOM_RESULT';
  domTree: DOMNode[];
  viewportSize: { width: number; height: number };
}

export interface ExecuteActionsRequest {
  type: 'EXECUTE_ACTIONS';
  plan: ActionPlan;
}

export interface ExecuteActionsResponse {
  type: 'EXECUTE_ACTIONS_RESULT';
  results: Array<{ action: string; selector: string; success: boolean; error?: string }>;
}

export interface ShowOverlayRequest {
  type: 'SHOW_OVERLAY';
  detections: Detection[];
}

export interface HideOverlayRequest {
  type: 'HIDE_OVERLAY';
}

// ─── Offscreen Document Messages ─────────────────────────────────────

export interface RunFaceDetectionRequest {
  type: 'RUN_FACE_DETECTION';
  screenshotDataUrl: string;
}

export interface RunFaceDetectionResponse {
  type: 'FACE_DETECTION_RESULT';
  detections: Detection[];
}

export interface BlurImageRegionsRequest {
  type: 'BLUR_IMAGE_REGIONS';
  screenshotDataUrl: string;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface BlurImageRegionsResponse {
  type: 'BLUR_IMAGE_REGIONS_RESULT';
  blurredDataUrl: string;
  width: number;
  height: number;
}

// ─── Popup ↔ Service Worker Messages ─────────────────────────────────

export interface StartPipelineRequest {
  type: 'START_PIPELINE';
}

export interface PipelineStatusUpdate {
  type: 'PIPELINE_STATUS';
  stage: PipelineStage;
  status: 'started' | 'completed' | 'error';
  data?: unknown;
  error?: string;
}

export interface PipelineCompleteMessage {
  type: 'PIPELINE_COMPLETE';
  payload: RaapV1Payload;
  actionPlan: ActionPlan | null;
  metrics: PipelineMetricsData;
  actionResults?: Array<{ action: string; selector: string; success: boolean; error?: string }>;
  /** Local-only evidence used by the popup's Judge View; never sent to the server. */
  judgeEvidence?: {
    values: Partial<Record<'FACE' | 'AADHAAR' | 'PASSWORD', string>>;
    faceBounds?: { x: number; y: number; width: number; height: number };
    screenshotDataUrl?: string | null;
    viewportSize: { width: number; height: number };
  };
}

export interface ToggleActivationRequest {
  type: 'TOGGLE_ACTIVATION';
  active?: boolean;
}

export interface GetStateRequest {
  type: 'GET_STATE';
}

export interface ContentReadyMessage {
  type: 'CONTENT_READY';
}

// ─── Pipeline Stages ─────────────────────────────────────────────────

export type PipelineStage =
  | 'capture'
  | 'dom_extract'
  | 'face_detect'
  | 'text_detect'
  | 'redaction'
  | 'network'
  | 'action_execute';

// ─── Union of all message types ──────────────────────────────────────

export type VeilMessage =
  | ExtractDOMRequest
  | ExtractDOMResponse
  | ExecuteActionsRequest
  | ExecuteActionsResponse
  | ShowOverlayRequest
  | HideOverlayRequest
  | RunFaceDetectionRequest
  | RunFaceDetectionResponse
  | BlurImageRegionsRequest
  | BlurImageRegionsResponse
  | StartPipelineRequest
  | PipelineStatusUpdate
  | PipelineCompleteMessage
  | ToggleActivationRequest
  | GetStateRequest
  | ContentReadyMessage;
