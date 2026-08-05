import { inflateSync } from "node:zlib";

/**
 * Minimal PNG decoder (8-bit, non-interlaced grayscale/RGB/RGBA only — the
 * subset Playwright's page/element .screenshot() always produces). No new
 * dependency: architecture fixes the dep list to playwright/pagedjs/pdfjs-dist/
 * commander/ajv/yaml, and Node's built-in zlib is all decoding needs beyond that.
 */
export class UnsupportedPngError extends Error {}

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new UnsupportedPngError("Not a PNG file (bad signature).");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset += 8 + length + 4; // length + type + data + crc
  }

  if (bitDepth !== 8) {
    throw new UnsupportedPngError(`Unsupported PNG bit depth ${bitDepth} (only 8-bit is supported).`);
  }
  if (interlace !== 0) {
    throw new UnsupportedPngError("Interlaced PNGs are not supported.");
  }
  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!channels) {
    throw new UnsupportedPngError(`Unsupported PNG color type ${colorType} (only grayscale/RGB/RGBA are supported).`);
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const row = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const outRow = new Uint8Array(stride);

    for (let x = 0; x < stride; x++) {
      const rawByte = row[x];
      const a = x >= bytesPerPixel ? outRow[x - bytesPerPixel] : 0;
      const b = prevRow[x];
      const c = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + Math.floor((a + b) / 2); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: throw new UnsupportedPngError(`Unsupported PNG filter type ${filterType}.`);
      }
      outRow[x] = value & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const srcIdx = x * bytesPerPixel;
      const dstIdx = (y * width + x) * 4;
      if (channels === 4) {
        pixels[dstIdx] = outRow[srcIdx];
        pixels[dstIdx + 1] = outRow[srcIdx + 1];
        pixels[dstIdx + 2] = outRow[srcIdx + 2];
        pixels[dstIdx + 3] = outRow[srcIdx + 3];
      } else if (channels === 3) {
        pixels[dstIdx] = outRow[srcIdx];
        pixels[dstIdx + 1] = outRow[srcIdx + 1];
        pixels[dstIdx + 2] = outRow[srcIdx + 2];
        pixels[dstIdx + 3] = 255;
      } else if (channels === 2) {
        pixels[dstIdx] = pixels[dstIdx + 1] = pixels[dstIdx + 2] = outRow[srcIdx];
        pixels[dstIdx + 3] = outRow[srcIdx + 1];
      } else {
        pixels[dstIdx] = pixels[dstIdx + 1] = pixels[dstIdx + 2] = outRow[srcIdx];
        pixels[dstIdx + 3] = 255;
      }
    }

    prevRow.set(outRow);
  }

  return { width, height, pixels };
}

/**
 * Fraction of an NxN grid of cells that hold more than one quantized color —
 * i.e. how much of the page carries something other than flat fill, and, just
 * as importantly, *where*.
 *
 * This measures spatial spread rather than amount, which is what separates a
 * full-bleed image from a page that merely has marks on it. Neither simpler
 * measurement can: ink coverage counts pixels differing from the dominant
 * color, so full-bleed artwork whose own dominant tone fills the page scores
 * low; and a whole-page distinct-color count is dominated by text antialiasing,
 * so a *broken* image plus one line of alt text scores in the hundreds, right
 * alongside real artwork. (Both were measured against a genuinely broken cover
 * before this replaced them — 0.65% ink and 563 colors, indistinguishable from
 * a healthy page on either scale.) An image that actually covers its page
 * textures every cell; marks concentrated in one corner texture only the cells
 * they occupy.
 */
export function texturedCellRatio(png: DecodedPng, grid = 8): number {
  const { width, height, pixels } = png;
  let textured = 0;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * width) / grid);
      const x1 = Math.floor(((gx + 1) * width) / grid);
      const y0 = Math.floor((gy * height) / grid);
      const y1 = Math.floor(((gy + 1) * height) / grid);

      let first = -1;
      let varied = false;
      for (let y = y0; y < y1 && !varied; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          const key = ((pixels[o] >> 3) << 10) | ((pixels[o + 1] >> 3) << 5) | (pixels[o + 2] >> 3);
          if (first === -1) first = key;
          else if (key !== first) { varied = true; break; }
        }
      }
      if (varied) textured++;
    }
  }

  return textured / (grid * grid);
}

/**
 * Fraction of pixels that are "ink" (meaningfully different from the page's
 * dominant background color) vs blank page. Background is estimated as the
 * most frequent quantized color rather than trusting a single corner pixel —
 * some pages (back-cover) are a solid brand color, not color-bg.
 */
export function inkCoverageRatio(png: DecodedPng, distanceThreshold = 24): number {
  const { width, height, pixels } = png;
  const totalPixels = width * height;
  const bucketOf = new Map<number, number>();
  const QUANT = 8; // bucket size per channel, keeps histogram cardinality small

  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const r = pixels[o] >> 3, g = pixels[o + 1] >> 3, b = pixels[o + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    bucketOf.set(key, (bucketOf.get(key) ?? 0) + 1);
  }

  let bgKey = -1;
  let bgCount = -1;
  for (const [key, count] of bucketOf) {
    if (count > bgCount) { bgCount = count; bgKey = key; }
  }
  const bgR = ((bgKey >> 10) & 0x1f) * QUANT;
  const bgG = ((bgKey >> 5) & 0x1f) * QUANT;
  const bgB = (bgKey & 0x1f) * QUANT;

  let inkPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const dr = pixels[o] - bgR, dg = pixels[o + 1] - bgG, db = pixels[o + 2] - bgB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance > distanceThreshold) inkPixels++;
  }

  return inkPixels / totalPixels;
}
