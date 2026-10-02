import zlib from 'node:zlib';
import fs from 'node:fs';

const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = -1; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

function png(s) {
  const stride = s * 3 + 1, raw = Buffer.alloc(stride * s);
  const cos = Math.cos(-0.49), sin = Math.sin(-0.49);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const nx = x / s - 0.5, ny = y / s - 0.5;
    const rx = nx * cos - ny * sin, ry = nx * sin + ny * cos;
    const ring = Math.abs(Math.hypot(rx / 0.34, ry / 0.13) - 1) < 0.1;
    const v = Math.hypot(nx, ny) < 0.1 || ring ? 255 : 0;
    const i = y * stride + 1 + x * 3;
    raw[i] = raw[i + 1] = raw[i + 2] = v;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(s, 0); head.writeUInt32BE(s, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.writeFileSync('public/icons/icon-192.png', png(192));
fs.writeFileSync('public/icons/icon-512.png', png(512));
console.log('Icons written');
