// A minimal POSIX ustar writer: enough for an export archive of regular
// files whose sizes are known before their bytes are written. Readable by
// `tar`, libarchive, Python's tarfile and every common archive tool.

const BLOCK = 512;
// The size field holds 11 octal digits.
export const MAX_TAR_ENTRY = 8 ** 11 - 1;

function octal(header: Buffer, offset: number, length: number, value: number) {
  const digits = Math.floor(value)
    .toString(8)
    .padStart(length - 1, "0");
  if (digits.length > length - 1)
    throw new Error(`Value ${value} does not fit a tar header field.`);
  header.write(`${digits}\0`, offset, length, "ascii");
}

export function tarHeader(name: string, size: number, mtime: Date) {
  const header = Buffer.alloc(BLOCK, 0);
  const encoded = Buffer.from(name, "utf8");
  if (encoded.length > 100)
    throw new Error(`Archive path is too long: ${name}`);
  if (size > MAX_TAR_ENTRY)
    throw new Error(`Archive entry ${name} is larger than a tar entry allows.`);
  encoded.copy(header, 0);
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, mtime.getTime() / 1000);
  header.fill(0x20, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

// Zero bytes that complete an entry's last block.
export function tarPadding(size: number) {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK, 0);
}

// Two empty blocks end the archive.
export const tarEnd = () => Buffer.alloc(BLOCK * 2, 0);
