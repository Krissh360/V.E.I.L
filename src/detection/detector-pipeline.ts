/**
 * Detector Pipeline — coordinates image and text detection in parallel,
 * merges results into a unified Detection[] list.
 */

import type { DOMNode } from '@/types/screen-state';
import type { Detection, DetectionType } from '@/types/detection';
import { detectTextPII } from './text-detector';
import { detectFaces } from './image-detector';
import { PipelineTimer } from '@/metrics/pipeline-metrics';

const MODULE = 'DetectorPipeline';

/**
 * Run all detection pipelines and return merged results.
 *
 * @param domTree - The extracted DOM tree
 * @param screenshotDataUrl - Base64 screenshot (for face detection)
 * @param timer - Pipeline timer for metrics
 */
export async function runDetectionPipeline(
  domTree: DOMNode[],
  screenshotDataUrl: string | null,
  timer: PipelineTimer,
): Promise<Detection[]> {
  const allDetections: Detection[] = [];

  // Run text and image detection in parallel
  const [textDetections, faceDetections] = await Promise.all([
    // Text detection (synchronous but wrapped in promise for parallel execution)
    ((): Promise<Detection[]> => {
      timer.start('text_detect');
      const detections = detectTextPII(domTree);
      timer.end('text_detect');
      return Promise.resolve(detections);
    })(),

    // Face detection (async — talks to offscreen document)
    (async (): Promise<Detection[]> => {
      if (!screenshotDataUrl) {
        console.debug(`[VEIL:${MODULE}] No screenshot available, skipping face detection`);
        return [];
      }
      timer.start('face_detect');
      const detections = await detectFaces(screenshotDataUrl);
      timer.end('face_detect');
      return detections;
    })(),
  ]);

  allDetections.push(...textDetections, ...faceDetections);

  // Record detection counts by type
  const countsByType = new Map<DetectionType, number>();
  for (const d of allDetections) {
    countsByType.set(d.type, (countsByType.get(d.type) ?? 0) + 1);
  }
  for (const [type, count] of countsByType) {
    timer.recordDetections(type, count);
  }

  console.info(
    `[VEIL:${MODULE}] Detection complete: ${allDetections.length} total ` +
    `(${textDetections.length} text, ${faceDetections.length} face)`
  );

  return allDetections;
}
