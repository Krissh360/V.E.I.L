/**
 * Barrel export for all VEIL type contracts.
 */
export type { ScreenState, DOMNode, BoundingRect } from './screen-state';
export type {
  Detection,
  DetectionType,
  DetectionLocation,
  ImageRegion,
  DOMLocation,
} from './detection';
export type {
  RaapV1Payload,
  RedactedDOMNode,
  RedactionEntry,
  RedactedImage,
  PipelineMetricsData,
} from './raap';
export { createRaapPayload } from './raap';
export type { Action, ActionPlan, ActionType } from './action';
export { ALLOWED_ACTIONS, isValidActionType } from './action';
export type {
  VeilMessage,
  PipelineStage,
  ExtractDOMRequest,
  ExtractDOMResponse,
  ExecuteActionsRequest,
  ExecuteActionsResponse,
  ShowOverlayRequest,
  HideOverlayRequest,
  RunFaceDetectionRequest,
  RunFaceDetectionResponse,
  BlurImageRegionsRequest,
  BlurImageRegionsResponse,
  StartPipelineRequest,
  PipelineStatusUpdate,
  PipelineCompleteMessage,
  ContentReadyMessage,
} from './messages';
