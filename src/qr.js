"use strict";

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function makeGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function remainder(data, degree) {
  const gen = makeGenerator(degree);
  const msg = new Uint8Array(data.length + degree);
  msg.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const coef = msg[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j += 1) msg[i + j] ^= mul(gen[j], coef);
  }
  return msg.slice(data.length);
}

const VERSIONS = [
  { version: 1, ecc: "M", data: 16, ec: 10, size: 21, align: [], remainder: 0 },
  { version: 2, ecc: "M", data: 28, ec: 16, size: 25, align: [6, 18], remainder: 7 },
  { version: 3, ecc: "M", data: 44, ec: 26, size: 29, align: [6, 22], remainder: 7 },
  { version: 4, ecc: "L", data: 80, ec: 20, size: 33, align: [6, 26], remainder: 7 },
  { version: 5, ecc: "L", data: 108, ec: 26, size: 37, align: [6, 30], remainder: 7 },
];

function bitsFromBytes(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  }
  return bits;
}

function pushBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
}

function encodeBytes(text) {
  const data = Buffer.from(String(text), "utf8");
  let spec = null;
  for (const item of VERSIONS) {
    const capacity = item.data * 8;
    const needed = 4 + 8 + data.length * 8;
    if (needed <= capacity) {
      spec = item;
      break;
    }
  }
  if (!spec) {
    const error = new Error("qr-too-long");
    error.status = 400;
    throw error;
  }
  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, data.length, 8);
  for (const byte of data) pushBits(bits, byte, 8);
  const capacity = spec.data * 8;
  const terminator = Math.min(4, capacity - bits.length);
  pushBits(bits, 0, terminator);
  while (bits.length % 8) bits.push(0);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    bytes.push(value);
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (bytes.length < spec.data) {
    bytes.push(pads[pad]);
    pad ^= 1;
  }
  const ec = remainder(Uint8Array.from(bytes), spec.ec);
  return { spec, codewords: Uint8Array.from([...bytes, ...ec]) };
}

function blank(size) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function setFinder(modules, reserved, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= modules.length || x >= modules.length) continue;
      const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      modules[y][x] = on;
      reserved[y][x] = true;
    }
  }
}

function overlapsFinder(y, x, n) {
  const hit = (row, col) => y >= row - 1 && y <= row + 7 && x >= col - 1 && x <= col + 7;
  return hit(0, 0) || hit(0, n - 7) || hit(n - 7, 0);
}

function setAlignment(modules, reserved, center) {
  const n = modules.length;
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      if (overlapsFinder(center[0] + r, center[1] + c, n)) return;
    }
  }
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const y = center[0] + r;
      const x = center[1] + c;
      modules[y][x] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      reserved[y][x] = true;
    }
  }
}

function formatBits(ecc, mask) {
  const level = ecc === "L" ? 0b01 : 0b00;
  const data = (level << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
}

function reserveFormat(reserved) {
  const n = reserved.length;
  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }
}

function applyFormat(modules, ecc, mask) {
  const n = modules.length;
  const bits = formatBits(ecc, mask);
  const bit = (i) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i += 1) modules[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[n - 15 + i][8] = bit(i);
}

function maskFlip(mask, row, col) {
  switch (mask) {
    case 0: return ((row + col) & 1) === 0;
    case 1: return (row & 1) === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function placeData(modules, reserved, codewords) {
  const n = modules.length;
  const bits = bitsFromBytes(codewords);
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (reserved[y][x]) continue;
        modules[y][x] = i < bits.length ? bits[i] === 1 : false;
        i += 1;
      }
    }
  }
}

function penalty(modules) {
  const n = modules.length;
  let score = 0;
  const run = (get) => {
    for (let i = 0; i < n; i += 1) {
      let count = 1;
      let prev = get(i, 0);
      for (let j = 1; j < n; j += 1) {
        const bit = get(i, j);
        if (bit === prev) count += 1;
        else {
          if (count >= 5) score += 3 + (count - 5);
          count = 1;
          prev = bit;
        }
      }
      if (count >= 5) score += 3 + (count - 5);
    }
  };
  run((row, col) => modules[row][col]);
  run((col, row) => modules[row][col]);
  for (let r = 0; r < n - 1; r += 1) {
    for (let c = 0; c < n - 1; c += 1) {
      const bit = modules[r][c];
      if (bit === modules[r][c + 1] && bit === modules[r + 1][c] && bit === modules[r + 1][c + 1]) score += 3;
    }
  }
  const pattern = (row) => {
    const line = row.map((bit) => (bit ? "1" : "0")).join("");
    for (let i = 0; i <= line.length - 11; i += 1) {
      const slice = line.slice(i, i + 11);
      if (slice === "10111010000" || slice === "00001011101") score += 40;
    }
  };
  for (let r = 0; r < n; r += 1) pattern(modules[r]);
  for (let c = 0; c < n; c += 1) pattern(modules.map((row) => row[c]));
  let dark = 0;
  for (const row of modules) for (const bit of row) if (bit) dark += 1;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

function buildMatrix(text, forcedMask) {
  const { spec, codewords } = encodeBytes(text);
  const n = spec.size;
  const modules = blank(n);
  const reserved = blank(n);
  setFinder(modules, reserved, 0, 0);
  setFinder(modules, reserved, 0, n - 7);
  setFinder(modules, reserved, n - 7, 0);
  for (let i = 0; i < n; i += 1) {
    if (!reserved[6][i]) {
      modules[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      modules[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }
  for (const r of spec.align) {
    for (const c of spec.align) setAlignment(modules, reserved, [r, c]);
  }
  modules[n - 8][8] = true;
  reserved[n - 8][8] = true;
  reserveFormat(reserved);
  placeData(modules, reserved, codewords);
  let bestMask = 0;
  let bestScore = Infinity;
  let best = null;
  const masks = forcedMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forcedMask];
  for (const mask of masks) {
    const candidate = modules.map((row, r) => row.map((bit, c) => (reserved[r][c] ? bit : bit !== maskFlip(mask, r, c))));
    applyFormat(candidate, spec.ecc, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      best = candidate;
    }
  }
  return { matrix: best, mask: bestMask, version: spec.version, ecc: spec.ecc };
}

function qrSvg(text, sizePx = 232) {
  const { matrix } = buildMatrix(text);
  const n = matrix.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (matrix[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" role="img" aria-label="网站二维码"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#20352F" d="${path}"/></svg>`;
}

module.exports = { qrSvg, buildMatrix, encodeBytes };
