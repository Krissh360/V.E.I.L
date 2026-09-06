/**
 * Pipeline Metrics — timestamps each stage of the VEIL pipeline
 * and tracks detection counts by type.
 */

import type { DetectionType, PipelineMetricsData, PipelineStage } from '@/types';

export class PipelineTimer {
  private starts: Map<string, number> = new Map();
  private timings: Map<string, number> = new Map();
  private detectionCounts: Map<DetectionType, number> = new Map();

  /** Mark the start of a pipeline stage */
  start(stage: PipelineStage): void {
    this.starts.set(stage, performance.now());
    console.log(`[VEIL Metrics] ${stage} started`);
  }

  /** Mark the end of a pipeline stage */
  end(stage: PipelineStage): number {
    const startTime = this.starts.get(stage);
    if (startTime === undefined) {
      console.warn(`[VEIL Metrics] ${stage} was never started`);
      return 0;
    }
    const duration = performance.now() - startTime;
    this.timings.set(stage, duration);
    console.log(`[VEIL Metrics] ${stage} completed in ${duration.toFixed(1)}ms`);
    return duration;
  }

  /** Record detection counts from a detection run */
  recordDetections(type: DetectionType, count: number): void {
    const existing = this.detectionCounts.get(type) ?? 0;
    this.detectionCounts.set(type, existing + count);
  }

  /** Get the total number of detections across all types */
  get totalDetections(): number {
    let total = 0;
    for (const count of this.detectionCounts.values()) {
      total += count;
    }
    return total;
  }

  /** Serialize to a PipelineMetricsData object for the RAAP payload */
  toMetricsData(): PipelineMetricsData {
    const timings: Record<string, number> = {};
    for (const [key, value] of this.timings) {
      timings[key] = Math.round(value);
    }

    const detectionCounts: Partial<Record<DetectionType, number>> = {};
    for (const [key, value] of this.detectionCounts) {
      detectionCounts[key] = value;
    }

    return {
      timings,
      detectionCounts,
      totalDetections: this.totalDetections,
    };
  }

  /** Log a full summary to console */
  logSummary(): void {
    console.group('[VEIL Metrics] Pipeline Summary');
    console.table(Object.fromEntries(this.timings));
    console.log('Detections:', Object.fromEntries(this.detectionCounts));
    console.log('Total detections:', this.totalDetections);
    console.groupEnd();
  }
}
