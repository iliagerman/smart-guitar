// Small math helpers shared by every set.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const range = (v, a, b) => clamp((v - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeOutBack = (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

// Elastic pop 0 -> 1 with overshoot, for characters springing into place.
export function pop(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(t * 11);
}

// Deterministic random numbers so every visitor sees the same room.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Squash and stretch on a beat: 1 at rest, dips on the downbeat, overshoots after.
export function bounce(phase) {
  const p = phase - Math.floor(phase);
  const hit = Math.exp(-p * 9);
  return { squash: 1 - 0.1 * hit + 0.04 * Math.sin(p * Math.PI * 2) * (1 - hit), lift: Math.max(0, Math.sin(p * Math.PI)) };
}
