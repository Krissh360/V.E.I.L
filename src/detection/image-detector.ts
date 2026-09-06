/**
 * Image Detector — coordinates face/visual PII detection via the
 * offscreen document where ONNX Runtime Web runs.
 *
 * --- PHASE 1 STUB ---
 * For Phase 1, if the offscreen document isn't available or the model
 * hasn't loaded, this returns an empty detection array. The ONNX
 * integration is in Phase H. The pipeline still works end-to-end
 * because text detection provides the primary detections.
 * --- END PHASE 1 STUB ---
 */

import type { Detection } from '@/types/detection';
import type { RunFaceDetectionRequest, RunFaceDetectionResponse } from '@/types/messages';

const MODULE = 'ImageDetector';

/**
 * Detect faces and visual PII in a screenshot.
 * Sends the screenshot to the offscreen document for ONNX inference.
 *
 * @param screenshotDataUrl - Base64 data URL of the screenshot
 * @returns Detection array with face bounding boxes
 */
export async function detectFaces(screenshotDataUrl: string): Promise<Detection[]> {
  try {
    const request: RunFaceDetectionRequest = {
      type: 'RUN_FACE_DETECTION',
      screenshotDataUrl,
    };

    const response = await chrome.runtime.sendMessage(request) as RunFaceDetectionResponse | undefined;

    if (!response || response.type !== 'FACE_DETECTION_RESULT') {
      console.warn(`[VEIL:${MODULE}] No face detection response — offscreen document may not be ready`);
      return [];
    }

    console.debug(`[VEIL:${MODULE}] Detected ${response.detections.length} faces`);
    return response.detections;
  } catch (error) {
    // --- PHASE 1: graceful fallback ---
    // If the offscreen document isn't set up yet, face detection is skipped.
    // The pipeline still works via text detection.
    console.warn(`[VEIL:${MODULE}] Face detection unavailable (Phase 1 stub):`, error);
    return [];
  }
}
