/**
 * A tiny dependency-free ZIP writer.
 *
 * Entries are stored uncompressed (method 0). That's the right trade-off here:
 * everything we put in a zip is already-compressed image data, so deflating it
 * would burn CPU for ~0% gain.
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Convert a Date to the (date << 16 | time) DOS representation zip uses. */
function dosDateTime(date: Date): number {
  const year = Math.max(date.getFullYear() - 1980, 0);
  const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1);
  return ((dosDate << 16) | dosTime) >>> 0;
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** Max value of the 32-bit size/offset fields in a (non-zip64) zip. */
const MAX_ZIP_SIZE = 0xffffffff;

/**
 * Build a zip file from the given entries.
 *
 * Names are used as-is, so de-duplicate them before calling.
 */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length > 0xffff) {
    throw Error('Too many files for a single zip');
  }

  const encoder = new TextEncoder();
  const fileParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  const now = dosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true); // signature
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0x0800, true); // flags: UTF-8 names
    localHeader.setUint16(8, 0, true); // method: store
    localHeader.setUint32(10, now, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true); // compressed size
    localHeader.setUint32(22, data.length, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // signature
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0x0800, true); // flags: UTF-8 names
    centralHeader.setUint16(10, 0, true); // method: store
    centralHeader.setUint32(12, now, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true); // compressed size
    centralHeader.setUint32(24, data.length, true); // uncompressed size
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // offset of local header

    fileParts.push(localHeader.buffer, nameBytes, data);
    centralParts.push(centralHeader.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;

    if (offset > MAX_ZIP_SIZE) {
      throw Error('Zip too large — download the images individually instead');
    }
  }

  const centralSize = centralParts.reduce(
    (total, part) => total + (part as ArrayBuffer | Uint8Array).byteLength,
    0,
  );

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // signature
  end.setUint16(4, 0, true); // disk number
  end.setUint16(6, 0, true); // disk with central directory
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // offset of central directory
  end.setUint16(20, 0, true); // comment length

  return new Blob([...fileParts, ...centralParts, end.buffer], {
    type: 'application/zip',
  });
}

/**
 * Make each name unique by appending ` (2)`, ` (3)`… before the extension.
 * Different source images can easily encode to the same output name.
 */
export function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();

  return names.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }

    const dot = name.lastIndexOf('.');
    const base = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? '' : name.slice(dot);

    for (let i = 2; ; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  });
}
