/**
 * Image Processing Utilities
 * Workers-compatible image handling using only Web APIs
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Image format signatures (magic bytes)
 */
const IMAGE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  gif: [0x47, 0x49, 0x46, 0x38], // GIF8
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF (WebP container)
  bmp: [0x42, 0x4d], // BM
} as const;

type ImageFormat = keyof typeof IMAGE_SIGNATURES;

/**
 * Detect image format from magic bytes
 */
export function detectImageFormat(data: ArrayBuffer): ImageFormat | null {
  const bytes = new Uint8Array(data.slice(0, 12));

  // Check PNG
  if (matchesSignature(bytes, IMAGE_SIGNATURES.png)) {
    return 'png';
  }

  // Check JPEG
  if (matchesSignature(bytes, IMAGE_SIGNATURES.jpeg)) {
    return 'jpeg';
  }

  // Check GIF
  if (matchesSignature(bytes, IMAGE_SIGNATURES.gif)) {
    return 'gif';
  }

  // Check WebP (RIFF container with WEBP identifier)
  if (matchesSignature(bytes, IMAGE_SIGNATURES.webp)) {
    // WebP has "WEBP" at offset 8
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'webp';
    }
  }

  // Check BMP
  if (matchesSignature(bytes, IMAGE_SIGNATURES.bmp)) {
    return 'bmp';
  }

  return null;
}

/**
 * Check if bytes match a signature
 */
function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Validate if data is a valid image format
 */
export function validateImageFormat(data: ArrayBuffer): boolean {
  return detectImageFormat(data) !== null;
}

/**
 * Get image dimensions by parsing the image header
 * Supports JPEG, PNG, GIF, WebP, and BMP
 */
export function getImageDimensions(data: ArrayBuffer): ImageDimensions | null {
  const format = detectImageFormat(data);
  
  if (!format) {
    return null;
  }

  switch (format) {
    case 'png':
      return getPngDimensions(data);
    case 'jpeg':
      return getJpegDimensions(data);
    case 'gif':
      return getGifDimensions(data);
    case 'webp':
      return getWebpDimensions(data);
    case 'bmp':
      return getBmpDimensions(data);
    default:
      return null;
  }
}

/**
 * Get PNG dimensions from IHDR chunk
 */
function getPngDimensions(data: ArrayBuffer): ImageDimensions | null {
  const view = new DataView(data);
  
  // PNG dimensions are at bytes 16-23 (after 8-byte signature and 8-byte IHDR header)
  if (data.byteLength < 24) {
    return null;
  }

  const width = view.getUint32(16, false); // Big-endian
  const height = view.getUint32(20, false);

  return { width, height };
}

/**
 * Get JPEG dimensions from SOF marker
 */
function getJpegDimensions(data: ArrayBuffer): ImageDimensions | null {
  const bytes = new Uint8Array(data);
  let offset = 2; // Skip SOI marker

  while (offset < bytes.length - 1) {
    // Look for marker
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = bytes[offset + 1];

    // Skip padding bytes
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // SOF markers (Start of Frame) contain dimensions
    // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 >= bytes.length) {
        return null;
      }

      const view = new DataView(data, offset + 5);
      const height = view.getUint16(0, false);
      const width = view.getUint16(2, false);

      return { width, height };
    }

    // Skip to next marker
    if (offset + 3 >= bytes.length) {
      return null;
    }

    const segmentLength = new DataView(data, offset + 2).getUint16(0, false);
    offset += segmentLength + 2;
  }

  return null;
}

/**
 * Get GIF dimensions from Logical Screen Descriptor
 */
function getGifDimensions(data: ArrayBuffer): ImageDimensions | null {
  if (data.byteLength < 10) {
    return null;
  }

  const view = new DataView(data);
  
  // GIF dimensions are at bytes 6-9 (little-endian)
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);

  return { width, height };
}

/**
 * Get WebP dimensions
 * Supports VP8, VP8L, and VP8X chunks
 */
function getWebpDimensions(data: ArrayBuffer): ImageDimensions | null {
  if (data.byteLength < 30) {
    return null;
  }

  const bytes = new Uint8Array(data);
  const view = new DataView(data);

  // Check chunk type at offset 12
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunkType === 'VP8 ') {
    // Lossy WebP
    // Skip to frame header (after chunk header)
    if (data.byteLength < 30) {
      return null;
    }
    
    // VP8 bitstream starts at offset 20
    // Frame tag is 3 bytes, then width/height
    const width = (view.getUint16(26, true) & 0x3fff);
    const height = (view.getUint16(28, true) & 0x3fff);

    return { width, height };
  }

  if (chunkType === 'VP8L') {
    // Lossless WebP
    if (data.byteLength < 25) {
      return null;
    }

    // VP8L signature at offset 20 (0x2f)
    const signature = bytes[20];
    if (signature !== 0x2f) {
      return null;
    }

    // Width and height are packed in 4 bytes at offset 21
    const bits = view.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;

    return { width, height };
  }

  if (chunkType === 'VP8X') {
    // Extended WebP (may have alpha, animation, etc.)
    if (data.byteLength < 30) {
      return null;
    }

    // Canvas width/height at offset 24-29 (24-bit values)
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;

    return { width, height };
  }

  return null;
}

/**
 * Get BMP dimensions from DIB header
 */
function getBmpDimensions(data: ArrayBuffer): ImageDimensions | null {
  if (data.byteLength < 26) {
    return null;
  }

  const view = new DataView(data);
  
  // DIB header starts at offset 14
  // Width at offset 18, height at offset 22 (signed 32-bit integers)
  const width = view.getInt32(18, true);
  let height = view.getInt32(22, true);

  // Height can be negative (top-down DIB)
  height = Math.abs(height);

  return { width, height };
}

/**
 * Generate a thumbnail key from the original key
 */
export function generateThumbnailKey(originalKey: string): string {
  const lastSlash = originalKey.lastIndexOf('/');
  const lastDot = originalKey.lastIndexOf('.');
  
  if (lastDot === -1 || lastDot < lastSlash) {
    // No extension
    return `${originalKey}_thumb`;
  }

  const basePath = originalKey.slice(0, lastDot);
  const extension = originalKey.slice(lastDot);

  return `${basePath}_thumb${extension}`;
}

/**
 * Generate multiple thumbnail keys for different sizes
 */
export function generateThumbnailKeys(
  originalKey: string,
  sizes: string[]
): Record<string, string> {
  const lastSlash = originalKey.lastIndexOf('/');
  const lastDot = originalKey.lastIndexOf('.');
  
  const basePath = lastDot === -1 || lastDot < lastSlash
    ? originalKey
    : originalKey.slice(0, lastDot);
  
  const extension = lastDot === -1 || lastDot < lastSlash
    ? ''
    : originalKey.slice(lastDot);

  const keys: Record<string, string> = {};
  
  for (const size of sizes) {
    keys[size] = `${basePath}_${size}${extension}`;
  }

  return keys;
}

/**
 * Get MIME type from image format
 */
export function getMimeTypeFromFormat(format: ImageFormat): string {
  const mimeTypes: Record<ImageFormat, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };

  return mimeTypes[format];
}

/**
 * Calculate aspect ratio
 */
export function calculateAspectRatio(width: number, height: number): number {
  return width / height;
}

/**
 * Calculate dimensions for resizing while maintaining aspect ratio
 */
export function calculateResizeDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): ImageDimensions {
  const aspectRatio = originalWidth / originalHeight;

  let newWidth = originalWidth;
  let newHeight = originalHeight;

  if (newWidth > maxWidth) {
    newWidth = maxWidth;
    newHeight = Math.round(newWidth / aspectRatio);
  }

  if (newHeight > maxHeight) {
    newHeight = maxHeight;
    newWidth = Math.round(newHeight * aspectRatio);
  }

  return { width: newWidth, height: newHeight };
}

/**
 * Check if image needs resizing based on max dimensions
 */
export function needsResize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): boolean {
  return width > maxWidth || height > maxHeight;
}
