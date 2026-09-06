/**
 * Image Redactor — destructively blurs face/PII regions in a screenshot.
 *
 * Uses OffscreenCanvas (in the service worker or offscreen document context)
 * to apply a heavy Gaussian blur to detected regions. The original pixel
 * data is destroyed — the blur is irreversible.
 *
 * This runs in the offscreen document where canvas is available.
 */

import type { ImageRegion } from '@/types/detection';
import type { RedactedImage } from '@/types/raap';

const MODULE = 'ImageRedactor';
const BLUR_RADIUS = 20; // pixels — heavy blur to fully obscure faces

/**
 * Destructively blur specified regions of a screenshot.
 * The original pixel data in the blurred regions is permanently destroyed.
 *
 * @param screenshotDataUrl - Base64 data URL of the screenshot
 * @param regions - Image regions to blur (face bounding boxes, etc.)
 * @returns RedactedImage with blurred regions, or null if no screenshot
 */
export async function blurImageRegions(
  screenshotDataUrl: string,
  regions: ImageRegion[],
): Promise<RedactedImage | null> {
  if (regions.length === 0) {
    // No regions to blur — return image as-is (or skip entirely)
    return null;
  }

  try {
    // Decode the screenshot
    const img = await loadImage(screenshotDataUrl);
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');

    // Draw the original image
    ctx.drawImage(img, 0, 0);

    // Apply destructive blur to each region
    for (const region of regions) {
      // Save the context state
      ctx.save();

      // Create a clipping region for the face area (with padding)
      const padding = 10;
      const x = Math.max(0, region.x - padding);
      const y = Math.max(0, region.y - padding);
      const w = Math.min(img.width - x, region.width + padding * 2);
      const h = Math.min(img.height - y, region.height + padding * 2);

      // Apply heavy blur filter to the region
      ctx.filter = `blur(${BLUR_RADIUS}px)`;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      // Redraw the image within the clipped region — the blur filter
      // ensures the pixels are irreversibly modified
      ctx.drawImage(img, 0, 0);

      // Additionally, draw a semi-transparent overlay to further obscure
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.fillRect(x, y, w, h);

      ctx.restore();
    }

    // Convert the modified canvas to a data URL
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);

    console.debug(`[VEIL:${MODULE}] Blurred ${regions.length} regions in ${img.width}x${img.height} image`);

    return {
      dataUrl,
      width: img.width,
      height: img.height,
      redactedRegions: regions.length,
    };
  } catch (error) {
    console.error(`[VEIL:${MODULE}] Image redaction failed:`, error);
    // On failure, return null — the VEIL filter will omit the image entirely
    // rather than risk sending unredacted pixels
    return null;
  }
}

/**
 * Load an image from a data URL.
 */
function loadImage(dataUrl: string): Promise<ImageBitmap> {
  return fetch(dataUrl)
    .then((res) => res.blob())
    .then((blob) => createImageBitmap(blob));
}

/**
 * Convert a Blob to a base64 data URL.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
