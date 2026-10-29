// Запись файла в OPFS через синхронный доступ (для Safari без createWritable).
self.onmessage = async (e) => {
  const { path, blob, chunk } = e.data;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle(path[path.length - 1], { create: true });
    const access = await file.createSyncAccessHandle();
    access.truncate(0);
    for (let pos = 0; pos < blob.size; pos += chunk) {
      const buf = new Uint8Array(await blob.slice(pos, pos + chunk).arrayBuffer());
      access.write(buf, { at: pos });
      self.postMessage({ bytes: buf.length });
    }
    access.flush();
    access.close();
    self.postMessage({ done: true });
  } catch (err) {
    self.postMessage({ error: String(err && err.message) });
  }
};
