/**
 * Image Handler - Detects image tags in AI responses and handles sending
 * 
 * The AI can include [IMAGE:key] tags in its response.
 * This module extracts those tags, removes them from the text,
 * and returns the images to be sent separately.
 */

import { getImage, getAvailableImageKeys } from "./imageCatalog";
import { logger } from "../utils/logger";

// Regex to match [IMAGE:key] tags
const IMAGE_TAG_REGEX = /\[IMAGE:(\w+)\]/g;

export interface ExtractedImages {
  cleanText: string; // Text with image tags removed
  images: Array<{
    key: string;
    url: string;
    caption?: string;
  }>;
}

/**
 * Extract image tags from response text
 * Returns clean text and list of images to send
 */
export function extractImages(responseText: string): ExtractedImages {
  const images: ExtractedImages["images"] = [];
  const matches = responseText.matchAll(IMAGE_TAG_REGEX);

  for (const match of matches) {
    const key = match[1];
    const imageInfo = getImage(key);

    if (imageInfo) {
      images.push({
        key,
        url: imageInfo.url,
        caption: imageInfo.caption,
      });
      logger.info("  Image tag detected", { key });
    } else {
      logger.warn("  Unknown image key in response", {
        key,
        available: getAvailableImageKeys(),
      });
    }
  }

  // Remove image tags from text
  const cleanText = responseText
    .replace(IMAGE_TAG_REGEX, "")
    .replace(/\s{2,}/g, " ") // Collapse multiple spaces
    .trim();

  return { cleanText, images };
}

/**
 * Check if response contains any image tags
 */
export function hasImageTags(responseText: string): boolean {
  return IMAGE_TAG_REGEX.test(responseText);
}

