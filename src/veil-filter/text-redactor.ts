/**
 * Text Redactor — replaces detected text PII in the DOM tree with
 * typed redaction tokens.
 *
 * Operates on a deep-cloned copy of the DOM tree. The original
 * DOMNode[] is never mutated.
 */

import type { DOMNode } from '@/types/screen-state';
import type { Detection, DetectionType, DOMLocation } from '@/types/detection';
import type { RedactedDOMNode, RedactionEntry } from '@/types/raap';

const MODULE = 'TextRedactor';

/** Counter for generating unique redaction tokens */
let tokenCounter = 0;

/**
 * Generate a unique redaction token for a given PII type.
 * e.g., "[REDACTED:EMAIL:1]", "[REDACTED:PHONE:2]"
 */
function generateToken(type: DetectionType): string {
  tokenCounter++;
  return `[REDACTED:${type}:${tokenCounter}]`;
}

/**
 * Deep-clone a DOMNode into a RedactedDOMNode.
 */
function cloneNode(node: DOMNode): RedactedDOMNode {
  return {
    tag: node.tag,
    role: node.role,
    attributes: { ...node.attributes },
    textContent: node.textContent,
    children: node.children.map(cloneNode),
    xpath: node.xpath,
    cssSelector: node.cssSelector,
  };
}

/**
 * Apply text redactions to a cloned DOM tree.
 *
 * @param domTree - Original DOM tree (not mutated)
 * @param detections - Text-based detections to redact
 * @returns Redacted tree + redaction map entries
 */
export function redactText(
  domTree: DOMNode[],
  detections: Detection[],
): { redactedTree: RedactedDOMNode[]; entries: RedactionEntry[] } {
  // Reset token counter for each redaction pass
  tokenCounter = 0;

  // Deep-clone the tree
  const redactedTree = domTree.map(cloneNode);
  const entries: RedactionEntry[] = [];

  // Index detections by xpath for efficient lookup
  const detectionsByXpath = new Map<string, Detection[]>();
  for (const d of detections) {
    if (d.location.kind !== 'dom') continue;
    const xpath = d.location.xpath;
    const existing = detectionsByXpath.get(xpath) ?? [];
    existing.push(d);
    detectionsByXpath.set(xpath, existing);
  }

  // Walk the cloned tree and apply redactions
  function walkAndRedact(node: RedactedDOMNode): void {
    const nodeDetections = detectionsByXpath.get(node.xpath) ?? [];

    for (const detection of nodeDetections) {
      const loc = detection.location as DOMLocation;
      const token = generateToken(detection.type);

      // Handle password fields: strip the value attribute entirely
      if (detection.type === 'PASSWORD') {
        if (node.attributes['value']) {
          node.attributes['value'] = token;
        }
        if (node.attributes['type'] === 'password') {
          // Keep type attribute but mark as redacted
          node.textContent = token;
        }
        entries.push({
          type: detection.type,
          token,
          location: loc,
          confidence: detection.confidence,
        });
        continue;
      }

      // Handle text content redaction with offsets
      if (node.textContent && detection.rawValue) {
        // Replace the raw value in the text content
        node.textContent = node.textContent.replace(detection.rawValue, token);
      }

      // Handle input value redaction
      if (node.attributes['value'] && detection.rawValue) {
        node.attributes['value'] = node.attributes['value'].replace(
          detection.rawValue,
          token
        );
      }

      entries.push({
        type: detection.type,
        token,
        location: loc,
        confidence: detection.confidence,
      });
    }

    // Recurse into children
    for (const child of node.children) {
      walkAndRedact(child);
    }
  }

  for (const root of redactedTree) {
    walkAndRedact(root);
  }

  console.debug(`[VEIL:${MODULE}] Applied ${entries.length} text redactions`);
  return { redactedTree, entries };
}
