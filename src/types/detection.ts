/**
 * Detection types — the output of the local detection pipeline.
 * Identifies what sensitive content was found and where.
 */

/** All supported PII detection types */
export type DetectionType =
  | 'FACE'
  | 'EMAIL'
  | 'PHONE'
  | 'PASSWORD'
  | 'AADHAAR'
  | 'PAN'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'NAME'
  | 'ID';

/** A region in the screenshot image (pixel coordinates) */
export interface ImageRegion {
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A location in the DOM tree */
export interface DOMLocation {
  kind: 'dom';
  /** XPath to the containing element */
  xpath: string;
  /** CSS selector alternative */
  cssSelector?: string;
  /** Character offset within textContent where the match starts */
  startOffset?: number;
  /** Character offset within textContent where the match ends */
  endOffset?: number;
}

/** Union of possible detection locations */
export type DetectionLocation = ImageRegion | DOMLocation;

/**
 * A single detected piece of sensitive content.
 */
export interface Detection {
  /** What kind of PII was detected */
  type: DetectionType;
  /** Where it was found (image region or DOM path) */
  location: DetectionLocation;
  /** Confidence score 0–1 */
  confidence: number;
  /** The raw matched value (for text detections) — only used internally, never transmitted */
  rawValue?: string;
}
