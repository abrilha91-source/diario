// ZIP mínimo sin dependencias (funciona sin internet).
// Escribe sin compresión (las fotos y audios ya vienen comprimidos) y lee
// archivos guardados sin compresión o con "deflate".
(function (global) {
  const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8, crc = 0) { crc = ~crc >>> 0; for (let i = 0; i < u8.length; i++) crc = TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8); return (~crc) >>> 0; }
  const enc = new TextEncoder();
  function dosTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }
  // files: [{name, data: Blob|Uint8Array|string}]  -> Blob
  async function createZip(files, onProgress) {
    const parts = [], central = []; let offset = 0; const now = dosTime(new Date());
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let u8 = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
      const name = enc.encode(f.name); const crc = crc32(u8); const size = u8.length;
      if (offset + size > 0xFFFFFFF0) throw new Error('El respaldo supera 4 GB.');
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, now.time, true); lh.setUint16(12, now.date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, u8);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, now.time, true); ch.setUint16(14, now.date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
      u8 = null;
      if (onProgress) onProgress(i + 1, files.length);
    }
    const cdSize = central.reduce((s, p) => s + (p.byteLength || p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  // blob -> Map(name -> Blob)
  async function readZip(blob) {
    const tailLen = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('No parece un archivo .zip válido.');
    const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder(); const out = new Map(); let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP dañado.');
      const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true), loff = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const lh = new DataView(await blob.slice(loff, loff + 30).arrayBuffer());
      const start = loff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      let data = blob.slice(start, start + csize);
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede leer ZIP comprimidos. Usa el respaldo tal como lo exportó la app.');
        data = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      } else if (method !== 0) throw new Error('Formato de compresión no compatible.');
      out.set(name, data);
    }
    return out;
  }
  global.MiniZip = { createZip, readZip, crc32 };
})(self);
