// Local QR encoding for the existing SGMS:1:<64 hex characters> payload only.
// Version 4, error correction L: 80 data codewords + 20 parity codewords.
// No household identifiers or tokens are sent to a third-party image service.
export function householdQrPath(payload: string): { size: number; path: string } {
  if (!/^SGMS:1:[a-f0-9]{64}$/.test(payload)) throw new Error("Use a newly registered household-bin QR payload.");
  const size = 33;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = modules.map(row => row.slice());
  const mark = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) { mark(6, i, i % 2 === 0); mark(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      mark(cx + dx, cy + dy, distance !== 2 && distance !== 4);
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    mark(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask: number) => {
    const data = (1 << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) mark(8, i, bit(i));
    mark(8, 7, bit(6)); mark(8, 8, bit(7)); mark(7, 8, bit(8));
    for (let i = 9; i < 15; i++) mark(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) mark(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) mark(8, size - 15 + i, bit(i));
    mark(8, size - 8, true);
  };
  format(0);

  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  append(4, 4); // Byte mode; the registered payload is ASCII.
  append(payload.length, 8);
  for (const character of payload) append(character.charCodeAt(0), 8);
  append(0, 4);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  for (let pad = 0; data.length < 80; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);
  const multiply = (left: number, right: number) => {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if (right & 1) value ^= left;
      left = (left << 1) ^ ((left >>> 7) * 0x11d);
      right >>>= 1;
    }
    return value;
  };
  const divisor = Array<number>(20).fill(0);
  divisor[19] = 1;
  let root = 1;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      divisor[j] = multiply(divisor[j], root);
      if (j < 19) divisor[j] ^= divisor[j + 1];
    }
    root = multiply(root, 2);
  }
  const parity = Array<number>(20).fill(0);
  for (const byte of data) {
    const factor = byte ^ parity.shift()!;
    parity.push(0);
    for (let j = 0; j < 20; j++) parity[j] ^= multiply(divisor[j], factor);
  }
  const codewords = [...data, ...parity];
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        if (reserved[y][x]) continue;
        modules[y][x] = index < codewords.length * 8 && ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
        index++;
      }
    }
  }
  const unmasked = modules.map(row => row.slice());
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => (x * y) % 2 + (x * y) % 3 === 0,
    (x: number, y: number) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x: number, y: number) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];
  const penalty = () => {
    let score = 0, dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (x && y && modules[y][x] === modules[y - 1][x] && modules[y][x] === modules[y][x - 1] && modules[y][x] === modules[y - 1][x - 1]) score += 3;
    }
    for (let axis = 0; axis < 2; axis++) for (let line = 0; line < size; line++) {
      const values = Array.from({ length: size }, (_, i) => axis ? modules[i][line] : modules[line][i]);
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && values[i] === values[i - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      const pattern = values.map(value => value ? "1" : "0").join("");
      for (let i = 0; i <= size - 11; i++) if (["00001011101", "10111010000"].includes(pattern.slice(i, i + 11))) score += 40;
    }
    return score + Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
  };
  let best = modules.map(row => row.slice()), bestScore = Infinity;
  for (let mask = 0; mask < masks.length; mask++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!reserved[y][x]) modules[y][x] = unmasked[y][x] !== masks[mask](x, y);
    }
    format(mask);
    const score = penalty();
    if (score < bestScore) { bestScore = score; best = modules.map(row => row.slice()); }
  }
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (best[y][x]) path += `M${x + 4},${y + 4}h1v1h-1z`;
  }
  return { size: size + 8, path };
}
