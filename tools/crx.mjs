// Minimal, dependency-free CRX3 writer (store-only fields Chrome needs) and zip builder.
import { createHash, createPublicKey, sign } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Extension id = first 16 bytes of sha256(SPKI DER), hex digits mapped 0-f -> a-p.
export function extensionId(spkiDer) {
  const hex = createHash('sha256').update(spkiDer).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export function publicKeyDer(privatePem) {
  return createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// Deterministic zip (fixed timestamps) so the same source gives the same CRX.
export function zipDir(dir) {
  const locals = [], centrals = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'));
    const raw = readFileSync(file);
    const data = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function varint(n) {
  const bytes = [];
  while (n > 0x7f) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; }
  bytes.push(n);
  return Buffer.from(bytes);
}
const field = (num, bytes) => Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);

export function buildCrx(zip, privatePem) {
  const spki = publicKeyDer(privatePem);
  const crxId = createHash('sha256').update(spki).digest().subarray(0, 16);
  const signedData = field(1, crxId);                                   // SignedData { crx_id }
  const lenLE = Buffer.alloc(4); lenLE.writeUInt32LE(signedData.length);
  const signature = sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00'), lenLE, signedData, zip]), privatePem);
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, spki), field(2, signature)])),     // sha256_with_rsa { public_key, signature }
    field(10000, signedData),                                           // signed_header_data
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'ascii'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

export function updatesXml({ id, version, crxUrl }) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${id}'>
    <updatecheck codebase='${crxUrl}' version='${version}' />
  </app>
</gupdate>
`;
}
