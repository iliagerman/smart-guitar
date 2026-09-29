// Plucked guitar strings synthesised with Karplus-Strong. Browsers only let
// sound start from a click or tap, so unlockAudio() runs inside those events;
// sound then plays only when the visitor touches a string.
let ctx = null;
let out = null;
const cache = new Map();

export const OPEN_STRINGS = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
export const E_MINOR = [82.41, 123.47, 164.81, 196.0, 246.94, 329.63];

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === "running") return;
  ctx.resume();
  // Safari only starts a context from inside a gesture, and playing a silent
  // buffer in that same gesture is what reliably unlocks it on iOS.
  const silent = ctx.createBufferSource();
  silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silent.connect(ctx.destination);
  silent.start();
}

function stringBuffer(freq) {
  const key = Math.round(freq * 10);
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const period = Math.max(2, Math.round(sr / freq));
  const ring = new Float32Array(period);
  // Pluck position shaping: a softened noise burst.
  for (let i = 0; i < period; i++) ring[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin((i / period) * Math.PI));
  const decay = 0.9965 - freq * 0.0000045;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const a = ring[idx];
    const b = ring[(idx + 1) % period];
    d[i] = a;
    ring[idx] = (a + b) * 0.5 * decay;
    idx = (idx + 1) % period;
  }
  cache.set(key, buf);
  return buf;
}

export function pluck(freq, velocity = 1, delay = 0) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = stringBuffer(freq);
  const g = ctx.createGain();
  g.gain.value = 0.32 * velocity;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  src.connect(tone);
  tone.connect(g);
  g.connect(out);
  src.start(ctx.currentTime + delay);
}
