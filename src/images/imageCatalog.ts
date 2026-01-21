/**
 * Image Catalog - Static images the agent can send
 * 
 * Each image has a unique key that the agent can reference via [IMAGE:key]
 * URLs should be publicly accessible (Cloudinary, S3, etc.)
 */

export interface ImageInfo {
  url: string;
  caption?: string; // Optional default caption
  description: string; // For AI context
}

/**
 * Catalog of available images
 * Add new images here - the agent can send any of these
 */
export const IMAGE_CATALOG: Record<string, ImageInfo> = {
  // מחירון
  price_table: {
    url: "https://res.cloudinary.com/daowx6msw/image/upload/v1765802275/WhatsApp_Image_2025-11-26_at_12.01.00_gaafrs.jpg",
    caption: "המחירון שלנו 💰",
    description: "טבלת מחירים של כל החבילות - כסף, זהב, יהלום",
  },

  // מסך ראשי - סיכום אישורי הגעה
  system_dashboard: {
    url: "https://res.cloudinary.com/daowx6msw/image/upload/v1766420595/%D7%A6%D7%99%D7%9C%D7%95%D7%9E%D7%99_%D7%9E%D7%A1%D7%9A_%D7%9E%D7%90%D7%A9%D7%A8%D7%99%D7%9D_%D7%91%D7%A7%D7%9C%D7%99%D7%A7_ey20v1.jpg",
    caption: "כך נראית המערכת שלנו 📊",
    description: "מסך ראשי של המערכת - סיכום מי אישר הגעה ומי לא",
  },

  // פירוט סטטוס לכל אורח
  guest_status: {
    url: "https://res.cloudinary.com/daowx6msw/image/upload/v1766420595/WhatsApp_Image_2025-12-16_at_13.17.50_nykbtj.jpg",
    caption: "פירוט סטטוס לכל אורח 👥",
    description: "תצוגת פירוט סטטוס של כל אורח במערכת",
  },
};

/**
 * Get image info by key
 */
export function getImage(key: string): ImageInfo | null {
  return IMAGE_CATALOG[key] || null;
}

/**
 * Get all available image keys (for AI context)
 */
export function getAvailableImageKeys(): string[] {
  return Object.keys(IMAGE_CATALOG);
}

/**
 * Get image descriptions for AI (so it knows what images are available)
 */
export function getImageDescriptions(): string {
  return Object.entries(IMAGE_CATALOG)
    .map(([key, info]) => `- [IMAGE:${key}] - ${info.description}`)
    .join("\n");
}

