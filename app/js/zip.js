// Чтение ZIP без сжатия (метод STORE) прямо из Blob/File: файлы не распаковываются в память,
// содержимое записи — это срез исходного Blob.

export class ZipError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

async function view(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

export async function readZipIndex(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = await view(blob, blob.size - tailLen, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not-zip', 'Это не ZIP-архив');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('zip64', 'ZIP64 не поддерживается');

  const cd = await view(blob, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== CD_SIG) throw new ZipError('not-zip', 'Повреждён центральный каталог');
    const method = cd.getUint16(p + 10, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (method !== 0) throw new ZipError('compressed', `Запись ${name} сжата`);
    entries.set(name, { localOffset, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  for (const [name, e] of entries) {
    const local = await view(blob, e.localOffset, e.localOffset + 30);
    if (local.getUint32(0, true) !== LOCAL_SIG) throw new ZipError('not-zip', `Повреждена запись ${name}`);
    const offset = e.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    entries.set(name, { offset, size: e.size });
  }
  return entries;
}

export function entryBlob(blob, entry) {
  return blob.slice(entry.offset, entry.offset + entry.size);
}
