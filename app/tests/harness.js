// Мини-харнесс для модульных тестов в браузере. Результат — в window.__results.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}

export function assertThrows(fn, re) {
  try {
    fn();
  } catch (err) {
    if (re && !re.test(String(err && (err.code || '') + ' ' + err.message))) {
      throw new Error(`threw ${err.message}, expected ${re}`);
    }
    return;
  }
  throw new Error(`expected to throw ${re || ''}`);
}

export async function assertRejects(promise, re) {
  try {
    await promise;
  } catch (err) {
    if (re && !re.test(String(err && (err.code || '') + ' ' + err.message))) {
      throw new Error(`rejected with ${err.message}, expected ${re}`);
    }
    return;
  }
  throw new Error(`expected rejection ${re || ''}`);
}

// ZIP с методом STORE (без сжатия) из { имя: строка | Uint8Array } — для тестов импорта.
export function makeStoreZip(entries, { method = 0 } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameB = enc.encode(name);
    const body = typeof data === 'string' ? enc.encode(data) : data;
    const crc = crc32(body);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, nameB.length, true);
    chunks.push(new Uint8Array(local.buffer), nameB, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, body.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(entries).length, true);
  eocd.setUint16(10, Object.keys(entries).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)]);
}

function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export async function run() {
  const out = document.getElementById('results');
  const results = { passed: 0, failed: 0, failures: [] };
  for (const t of tests) {
    const li = document.createElement('li');
    try {
      await t.fn();
      results.passed++;
      li.textContent = `✓ ${t.name}`;
      li.className = 'pass';
    } catch (err) {
      results.failed++;
      results.failures.push({ name: t.name, message: String(err && err.message) });
      li.textContent = `✗ ${t.name}: ${err && err.message}`;
      li.className = 'fail';
    }
    out.append(li);
  }
  document.getElementById('summary').textContent = `${results.passed} passed, ${results.failed} failed`;
  window.__results = results;
  return results;
}
