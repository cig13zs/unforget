import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const INK = [28, 25, 21, 255];
const CREAM = [244, 239, 230, 255];
const VERMILION = [184, 66, 47, 255];

function canvas(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) };
}

function set(image, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.size || py >= image.size) return;
  const index = (py * image.size + px) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color[3];
}

function insideRoundRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || y < top || x >= right || y >= bottom) return false;
  const centers = [
    [left + radius, top + radius],
    [right - radius, top + radius],
    [left + radius, bottom - radius],
    [right - radius, bottom - radius],
  ];
  const inCornerZone =
    (x < left + radius && y < top + radius) ||
    (x >= right - radius && y < top + radius) ||
    (x < left + radius && y >= bottom - radius) ||
    (x >= right - radius && y >= bottom - radius);
  if (!inCornerZone) return true;
  return centers.some(([cx, cy]) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  });
}

function fillRoundRect(image, left, top, width, height, radius, color) {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      if (insideRoundRect(x, y, left, top, width, height, radius)) set(image, x, y, color);
    }
  }
}

function fillPolygon(image, points, color) {
  const minY = Math.floor(Math.min(...points.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y + 0.5 - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) set(image, x, y, color);
    }
  }
}

function scale(points, factor) {
  return points.map(([x, y]) => [x * factor, y * factor]);
}

function draw(size) {
  const factor = 4;
  const large = canvas(size * factor);
  const s = size * factor;
  const unit = s / 128;
  fillRoundRect(large, 0, 0, s, s, 28 * unit, INK);
  fillPolygon(large, scale([[44, 22], [92, 22], [92, 108], [68, 90], [44, 108]], unit), CREAM);
  fillPolygon(large, scale([[60, 22], [76, 22], [76, 70], [68, 62], [60, 70]], unit), VERMILION);
  return downsample(large, size);
}

function downsample(source, size) {
  const factor = source.size / size;
  const out = canvas(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const x0 = Math.floor(x * factor);
      const x1 = Math.floor((x + 1) * factor);
      const y0 = Math.floor(y * factor);
      const y1 = Math.floor((y + 1) * factor);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const index = (yy * source.size + xx) * 4;
          r += source.data[index];
          g += source.data[index + 1];
          b += source.data[index + 2];
          a += source.data[index + 3];
          n += 1;
        }
      }
      const index = (y * size + x) * 4;
      out.data[index] = r / n;
      out.data[index + 1] = g / n;
      out.data[index + 2] = b / n;
      out.data[index + 3] = a / n;
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(image) {
  const pixels = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const raw = Buffer.alloc((image.size * 4 + 1) * image.size);
  for (let y = 0; y < image.size; y++) {
    raw[y * (image.size * 4 + 1)] = 0;
    pixels.copy(raw, y * (image.size * 4 + 1) + 1, y * image.size * 4, (y + 1) * image.size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.size, 0);
  ihdr.writeUInt32BE(image.size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(draw(size));
  writeFileSync(`public/icons/${size}.png`, png);
  console.log(`public/icons/${size}.png`);
}
