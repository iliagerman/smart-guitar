// Procedural textures painted on canvases at start-up. Nothing is downloaded.
import * as THREE from "three";
import { rng } from "./util.js";

export function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

export function toTexture(c, { repeat = null, color = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Soft value noise: random pixels on a tiny canvas, smoothly scaled up.
function noiseLayer(ctx, w, h, cells, alpha, rand, light = false) {
  const [n, nc] = canvas(cells, Math.max(1, Math.round((cells * h) / w)));
  const img = nc.createImageData(n.width, n.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : v;
    img.data[i + 3] = light ? v : 255;
  }
  nc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = light ? "source-over" : "overlay";
  ctx.drawImage(n, 0, 0, w, h);
  ctx.restore();
}

// Long wavy grain lines, the basis of every wood surface.
function grain(ctx, w, h, { lines, dark, light, rand, wobble = 6, vertical = false }) {
  for (let i = 0; i < lines; i++) {
    const pos = rand() * (vertical ? w : h);
    const phase = rand() * 10;
    const amp = 0.5 + rand() * wobble;
    ctx.strokeStyle = rand() < 0.7 ? dark : light;
    ctx.globalAlpha = 0.08 + rand() * 0.22;
    ctx.lineWidth = 0.6 + rand() * 2.4;
    ctx.beginPath();
    const len = vertical ? h : w;
    for (let s = 0; s <= len; s += 8) {
      const off = Math.sin(s * 0.006 + phase) * amp + Math.sin(s * 0.021 + phase * 2) * amp * 0.35;
      if (vertical) ctx.lineTo(pos + off, s);
      else ctx.lineTo(s, pos + off);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function woodTexture({ base, dark, light, seed = 1, planks = 0, size = 1024, repeat = null, vertical = false, noise = 0.35, wobble = 6, lines = 260 }) {
  const [c, ctx] = canvas(size, size);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (planks) {
    const ph = size / planks;
    for (let p = 0; p < planks; p++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "255,220,180"},${0.03 + rand() * 0.09})`;
      ctx.fillRect(0, p * ph, size, ph);
    }
  }
  grain(ctx, size, size, { lines, dark, light, rand, vertical, wobble });
  noiseLayer(ctx, size, size, 64, noise, rand);
  if (planks) {
    const ph = size / planks;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (let p = 0; p <= planks; p++) {
      ctx.fillRect(0, p * ph - 1.5, size, 3);
      const joint = rand() * size;
      ctx.fillRect(joint, p * ph, 3, ph);
    }
  }
  return toTexture(c, { repeat });
}

// Spruce top with a tobacco sunburst. `bounds` maps the extrude UVs (shape
// coordinates) onto the canvas.
export function spruceTopTexture(bounds) {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  const rand = rng(7);
  ctx.fillStyle = "#e9b872";
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, { lines: 180, dark: "#9a6431", light: "#fbe2b2", rand, wobble: 2, vertical: true });
  noiseLayer(ctx, size, size, 48, 0.25, rand);
  const cx = ((0 - bounds.minX) / bounds.w) * size;
  const cy = ((-0.03 - bounds.minY) / bounds.h) * size;
  const g = ctx.createRadialGradient(cx, size - cy, size * 0.12, cx, size - cy, size * 0.62);
  g.addColorStop(0, "rgba(232,150,60,0)");
  g.addColorStop(0.55, "rgba(196,92,24,0.35)");
  g.addColorStop(0.8, "rgba(86,34,10,0.85)");
  g.addColorStop(1, "rgba(34,12,4,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = toTexture(c);
  t.repeat.set(1 / bounds.w, 1 / bounds.h);
  t.offset.set(-bounds.minX / bounds.w, -bounds.minY / bounds.h);
  return t;
}

export function rosetteTexture() {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const rand = rng(3);
  const r0 = size / 2;
  ctx.translate(r0, r0);
  const rings = [
    [1.0, "#1b0f08"], [0.94, "#f3e6c8"], [0.9, "#2b170c"], [0.86, "#c98b4a"],
    [0.8, "#1b0f08"], [0.76, "#f3e6c8"], [0.72, "#1b0f08"]
  ];
  for (const [f, col] of rings) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, r0 * f, 0, Math.PI * 2);
    ctx.fill();
  }
  // abalone-ish sparkle band
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const r = r0 * (0.8 + rand() * 0.06);
    ctx.fillStyle = `hsla(${160 + rand() * 120},70%,${55 + rand() * 25}%,${0.5 + rand() * 0.5})`;
    ctx.fillRect(Math.cos(a) * r, Math.sin(a) * r, 3, 3);
  }
  return toTexture(c);
}

export function tortoiseTexture() {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const rand = rng(11);
  ctx.fillStyle = "#2a0f06";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 6 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${170 + rand() * 60},${70 + rand() * 40},20,0.55)`);
    g.addColorStop(1, "rgba(80,20,5,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c);
}

export function plasterTexture(base = "#5b3a32", seed = 5) {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  noiseLayer(ctx, size, size, 12, 0.16, rand);
  noiseLayer(ctx, size, size, 90, 0.1, rand);
  noiseLayer(ctx, size, size, 400, 0.07, rand);
  return toTexture(c, { repeat: [2, 1] });
}

// Striped wallpaper with a small dotted motif.
export function wallpaperTexture(base = "#474c7a", stripe = "#50568a", dot = "#6a70a8") {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const rand = rng(33);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = stripe;
  for (let x = 0; x < size; x += 64) ctx.fillRect(x, 0, 30, size);
  ctx.fillStyle = dot;
  for (let y = 16; y < size; y += 32) {
    for (let x = 47; x < size; x += 64) {
      ctx.beginPath();
      ctx.arc(x + ((y / 32) % 2 ? 0 : 0), y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  noiseLayer(ctx, size, size, 32, 0.08, rand);
  noiseLayer(ctx, size, size, 256, 0.05, rand);
  return toTexture(c, { repeat: [9, 4] });
}

// A round braided rug: concentric bands on a circle.
export function rugTexture() {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  const rand = rng(44);
  const bands = ["#140a07", "#9a2a0e", "#1c0f0a", "#c2410c", "#120806", "#7c1d0c", "#e0801f", "#140a07", "#9a2a0e", "#1c0f0a", "#c2410c", "#0e0605"];
  const r0 = size / 2;
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(r0, r0, r0 * (1 - i / bands.length), 0, Math.PI * 2);
    ctx.fill();
  });
  // braid texture: tiny slanted marks around each ring
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 5000; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * r0;
    ctx.save();
    ctx.translate(r0 + Math.cos(a) * r, r0 + Math.sin(a) * r);
    ctx.rotate(a + 0.8);
    ctx.fillStyle = rand() < 0.5 ? "#000" : "#fff";
    ctx.fillRect(-4, -1, 8, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

export function fabricTexture(base, stripe = null, seed = 9, weave = 0.18, repeat = 3) {
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (stripe) {
    ctx.fillStyle = stripe;
    for (let y = 0; y < size; y += 64) ctx.fillRect(0, y, size, 14);
  }
  ctx.globalAlpha = weave;
  for (let i = 0; i < size; i += 3) {
    ctx.fillStyle = i % 6 ? "#000" : "#fff";
    ctx.fillRect(i, 0, 1, size);
    ctx.fillRect(0, i, size, 1);
  }
  ctx.globalAlpha = 1;
  noiseLayer(ctx, size, size, 128, 0.25, rand);
  return toTexture(c, { repeat: [repeat, repeat] });
}

// Night view through the window: gradient sky, moon, stars and a skyline.
export function nightSkyTexture() {
  const w = 1024;
  const h = 768;
  const [c, ctx] = canvas(w, h);
  const rand = rng(21);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0b1030");
  g.addColorStop(0.6, "#2a1f55");
  g.addColorStop(1, "#6b3a5c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.8})`;
    const s = rand() < 0.1 ? 2.2 : 1.2;
    ctx.fillRect(rand() * w, rand() * h * 0.65, s, s);
  }
  const mx = w * 0.72;
  const my = h * 0.24;
  const halo = ctx.createRadialGradient(mx, my, 10, mx, my, 170);
  halo.addColorStop(0, "rgba(255,240,210,0.55)");
  halo.addColorStop(1, "rgba(255,240,210,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff4dc";
  ctx.beginPath();
  ctx.arc(mx, my, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(210,190,160,0.35)";
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(mx - 20 + rand() * 40, my - 20 + rand() * 40, 5 + rand() * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  // skyline with lit windows
  let x = 0;
  while (x < w) {
    const bw = 40 + rand() * 90;
    const bh = h * (0.15 + rand() * 0.35);
    ctx.fillStyle = "#120c22";
    ctx.fillRect(x, h - bh, bw, bh);
    for (let wy = h - bh + 10; wy < h - 8; wy += 14) {
      for (let wx = x + 6; wx < x + bw - 8; wx += 11) {
        if (rand() < 0.28) {
          ctx.fillStyle = `rgba(255,${170 + rand() * 60},${80 + rand() * 60},${0.5 + rand() * 0.5})`;
          ctx.fillRect(wx, wy, 5, 7);
        }
      }
    }
    x += bw + 2;
  }
  return toTexture(c);
}

// Paper with blue rules and a red margin.
export function paperTexture({ w = 1024, h = 1024, rules = true, seed = 4 } = {}) {
  const [c, ctx] = canvas(w, h);
  const rand = rng(seed);
  ctx.fillStyle = "#f6efe1";
  ctx.fillRect(0, 0, w, h);
  noiseLayer(ctx, w, h, 256, 0.08, rand);
  noiseLayer(ctx, w, h, 24, 0.12, rand);
  if (rules) {
    ctx.strokeStyle = "rgba(90,130,190,0.45)";
    ctx.lineWidth = 2;
    for (let y = 120; y < h; y += 44) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(220,70,70,0.5)";
    ctx.beginPath();
    ctx.moveTo(110, 0);
    ctx.lineTo(110, h);
    ctx.stroke();
  }
  return [c, ctx];
}

export function grilleTexture() {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = "#9aa0a8";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#1a1c20";
  for (let y = 0; y < size; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 0; x < size; x += 8) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c, { repeat: [3, 2] });
}

export function glowSprite(inner = "rgba(255,255,255,1)") {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { color: false });
}

// Soft contact shadow painted under characters and props.
export function blobShadow() {
  const size = 128;
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.5, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { color: false });
}

// A text label painted onto a texture, for 3D signs.
export function labelTexture(text, { font = "130px 'Bebas Neue', Impact, sans-serif", color = "#fde047", w = 512, h = 192 } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 6);
  return toTexture(c);
}
