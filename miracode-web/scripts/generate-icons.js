import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, drawFn) {
  // RGBA buffer
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = r;
      raw[pixelOffset + 1] = g;
      raw[pixelOffset + 2] = b;
      raw[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = crc32(body);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // Color type RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC-32 implementation
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

// Draw Apple Intelligence Glowing Dark Squircle Icon
function drawAppleIcon(x, y, w, h) {
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  const dist = Math.sqrt(nx * nx + ny * ny);

  // Background: Deep titanium slate with subtle radial glow
  let r = 10, g = 10, b = 14, a = 255;

  // Squircle rounded boundary
  const squircle = Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 4);
  if (squircle > 0.85) {
    // Outside icon boundary for standard icon
    const edge = (squircle - 0.85) / 0.15;
    if (edge > 1) return [0, 0, 0, 0];
    a = Math.floor(255 * (1 - edge));
  }

  // Apple Intelligence Holographic Neural Core Gradient
  // Center is iridescent cyan, violet, magenta, amber
  const angle = Math.atan2(ny, nx);
  if (dist < 0.65) {
    const coreFactor = Math.pow(1 - dist / 0.65, 1.4);
    
    // Iridescent wave
    const wave = Math.sin(angle * 2.5 + dist * 5);
    const rGlow = Math.floor(120 + 130 * Math.sin(angle + 0.5) * coreFactor);
    const gGlow = Math.floor(100 + 120 * Math.sin(angle + 2.2) * coreFactor);
    const bGlow = Math.floor(200 + 55 * Math.cos(angle) * coreFactor);

    r = Math.min(255, Math.floor(r + rGlow * coreFactor * 0.9));
    g = Math.min(255, Math.floor(g + gGlow * coreFactor * 0.9));
    b = Math.min(255, Math.floor(b + bGlow * coreFactor * 1.1));
  }

  // Draw Code Brackets < / > in crisp bright white/silver
  // Left bracket '<' around nx: -0.35 to -0.15
  const inLeftBracket = Math.abs(Math.abs(ny * 1.8) + (nx + 0.22) * 1.8) < 0.08 && nx < -0.1 && nx > -0.32 && Math.abs(ny) < 0.28;
  // Right bracket '>' around nx: 0.15 to 0.35
  const inRightBracket = Math.abs(Math.abs(ny * 1.8) - (nx - 0.22) * 1.8) < 0.08 && nx > 0.1 && nx < 0.32 && Math.abs(ny) < 0.28;
  // Slash '/' in middle
  const inSlash = Math.abs(nx * 1.6 + ny * 0.9) < 0.06 && Math.abs(ny) < 0.24 && Math.abs(nx) < 0.18;

  if (inLeftBracket || inRightBracket || inSlash) {
    r = 250;
    g = 252;
    b = 255;
    a = 255;
  }

  // Subtle border rim
  if (squircle > 0.78 && squircle <= 0.85) {
    r = Math.min(255, r + 45);
    g = Math.min(255, g + 45);
    b = Math.min(255, b + 60);
  }

  return [r, g, b, a];
}

function drawMaskableIcon(x, y, w, h) {
  // Full bleed background without clipping squircle
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  const dist = Math.sqrt(nx * nx + ny * ny);

  let r = 10, g = 10, b = 14, a = 255;

  if (dist < 0.6) {
    const coreFactor = Math.pow(1 - dist / 0.6, 1.4);
    const angle = Math.atan2(ny, nx);
    const rGlow = Math.floor(120 + 130 * Math.sin(angle + 0.5) * coreFactor);
    const gGlow = Math.floor(100 + 120 * Math.sin(angle + 2.2) * coreFactor);
    const bGlow = Math.floor(200 + 55 * Math.cos(angle) * coreFactor);

    r = Math.min(255, Math.floor(r + rGlow * coreFactor * 0.9));
    g = Math.min(255, Math.floor(g + gGlow * coreFactor * 0.9));
    b = Math.min(255, Math.floor(b + bGlow * coreFactor * 1.1));
  }

  const inLeftBracket = Math.abs(Math.abs(ny * 1.8) + (nx + 0.2) * 1.8) < 0.08 && nx < -0.08 && nx > -0.3 && Math.abs(ny) < 0.25;
  const inRightBracket = Math.abs(Math.abs(ny * 1.8) - (nx - 0.2) * 1.8) < 0.08 && nx > 0.08 && nx < 0.3 && Math.abs(ny) < 0.25;
  const inSlash = Math.abs(nx * 1.6 + ny * 0.9) < 0.06 && Math.abs(ny) < 0.22 && Math.abs(nx) < 0.16;

  if (inLeftBracket || inRightBracket || inSlash) {
    r = 250;
    g = 252;
    b = 255;
    a = 255;
  }

  return [r, g, b, a];
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating 512x512 icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPNG(512, 512, drawAppleIcon));

console.log('Generating 512x512 maskable icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPNG(512, 512, drawMaskableIcon));

console.log('Generating 192x192 icon...');
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPNG(192, 192, drawAppleIcon));

console.log('Generating 180x180 apple-touch-icon...');
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPNG(180, 180, drawAppleIcon));

// Write clean SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c0d12"/>
      <stop offset="50%" stop-color="#141722"/>
      <stop offset="100%" stop-color="#090a0f"/>
    </linearGradient>
    <radialGradient id="neuralGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8"/>
      <stop offset="40%" stop-color="#818cf8" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#c084fc" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#0c0d12" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bracketGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#bg)"/>
  <rect width="510" height="510" x="1" y="1" rx="119" fill="none" stroke="#27272a" stroke-width="2"/>
  <circle cx="256" cy="256" r="160" fill="url(#neuralGlow)"/>
  <g filter="url(#glow)">
    <path d="M190 180 L120 256 L190 332" fill="none" stroke="url(#bracketGrad)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M285 170 L227 342" fill="none" stroke="#38bdf8" stroke-width="22" stroke-linecap="round"/>
    <path d="M322 180 L392 256 L322 332" fill="none" stroke="url(#bracketGrad)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle cx="256" cy="256" r="7" fill="#38bdf8"/>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg.trim());
console.log('All icons generated successfully!');
