/** Reads only width/height from PNG/JPEG headers — no full pixel decode needed for a DPI check. */
export interface ImageSize {
  width: number;
  height: number;
}

function readPngSize(buffer: Buffer): ImageSize | null {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(SIG)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    const isSofMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (isSofMarker) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

export function readImageSize(buffer: Buffer, fileName: string): ImageSize | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "png") return readPngSize(buffer);
  if (ext === "jpg" || ext === "jpeg") return readJpegSize(buffer);
  return null;
}
