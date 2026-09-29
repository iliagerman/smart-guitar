// The band: real instruments, each on its own stand, that play themselves.
// Plus the curious desk lamp. All built from primitives.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { grilleTexture, blobShadow } from "./textures.js";
import { lerp, pop, rng } from "./util.js";

export const STEM_COLORS = {
  // the fire palette of the burning-guitar brand
  vocals: "#fde047",
  guitar: "#fb923c",
  drums: "#ef4444",
  bass: "#b91c1c",
  keys: "#f59e0b",
  other: "#fdba74"
};

const lacquer = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, ...o });
const chrome = new THREE.MeshStandardMaterial({ color: "#e9e9ee", metalness: 1, roughness: 0.16 });
const steel = new THREE.MeshStandardMaterial({ color: "#26262b", metalness: 0.85, roughness: 0.38 });
const rubber = new THREE.MeshStandardMaterial({ color: "#111114", roughness: 0.7 });
const brass = new THREE.MeshStandardMaterial({ color: "#d9a441", metalness: 1, roughness: 0.22 });
let shadowTex = null;

function contactShadow(w, d) {
  shadowTex = shadowTex || blobShadow();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.renderOrder = 1;
  return m;
}

function rod(r, len, mat = steel) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.castShadow = true;
  return m;
}

// A tripod base with a centre pole, as on mic and drum stands.
const UP = new THREE.Vector3(0, 1, 0);
function tripod(root, height, spread = 0.16) {
  const pole = rod(0.009, height);
  pole.position.y = height / 2;
  root.add(pole);
  const hub = new THREE.Vector3(0, 0.1, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const foot = new THREE.Vector3(Math.cos(a) * spread, 0.006, Math.sin(a) * spread);
    const dir = foot.clone().sub(hub);
    const leg = rod(0.006, dir.length());
    leg.position.copy(hub).addScaledVector(dir, 0.5);
    leg.quaternion.setFromUnitVectors(UP, dir.normalize());
    root.add(leg);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), rubber);
    tip.position.copy(foot);
    root.add(tip);
  }
}

// Shared life: fade in, a small lean on the beat, and a quieter, dimmer
// instrument when its track is muted.
function alive(parts) {
  let rest = 0;
  parts.state = { appear: 1, energy: 0.6, muted: false, beat: 0, look: new THREE.Vector3(0, 1, 5) };
  parts.tick = function (t, dt) {
    const s = parts.state;
    rest = lerp(rest, s.muted ? 1 : 0, 1 - Math.exp(-dt * 5));
    const energy = s.energy * (1 - rest * 0.9);
    const a = pop(s.appear);
    parts.root.scale.setScalar(Math.max(0.001, a));
    const pulse = Math.exp(-((s.beat + parts.offset) % 1) * 6);
    parts.root.rotation.z = (pulse - 0.3) * 0.012 * energy;
    if (parts.shadow) parts.shadow.scale.setScalar(Math.max(0.001, a));
    for (const m of parts.glow) m.emissiveIntensity = lerp(0.9, 0.12, rest) * (0.8 + 0.4 * pulse * energy);
    parts.move(t, dt, s.beat + parts.offset, energy);
  };
  return parts;
}

function base(name, color, seed) {
  const group = new THREE.Group();
  group.name = name;
  const root = new THREE.Group();
  group.add(root);
  // a thin lit accent in the track's colour; it dims when muted
  const accent = new THREE.MeshStandardMaterial({ color: "#111", emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
  return { group, root, accent, glow: [accent], color, offset: 0, anchor: new THREE.Vector3(0, 0.8, 0), seed };
}

export function createMic() {
  const p = base("vocals", STEM_COLORS.vocals, 31);
  const { root } = p;
  tripod(root, 0.5);
  const clip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 20), steel);
  clip.position.y = 0.52;
  root.add(clip);
  const mic = new THREE.Group();
  mic.position.y = 0.54;
  mic.rotation.x = 0.35;
  root.add(mic);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.026, 0.2, 40), steel);
  handle.position.y = 0.1;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0375, 0.012, 40), p.accent);
  band.position.y = 0.19;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.037, 0.035, 40), chrome);
  collar.position.y = 0.215;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 48, 32), new THREE.MeshStandardMaterial({ map: grilleTexture(), color: "#d8d8dc", metalness: 0.9, roughness: 0.32 }));
  head.position.y = 0.28;
  [handle, band, collar, head].forEach((m) => { m.castShadow = true; mic.add(m); });
  p.anchor.set(0, 0.86, 0);
  p.move = (t) => { mic.rotation.z = Math.sin(t * 0.9) * 0.02; };
  p.shadow = contactShadow(0.4, 0.4);
  p.group.add(p.shadow);
  return alive(p);
}

export function createDrum() {
  const p = base("drums", STEM_COLORS.drums, 41);
  const { root } = p;
  tripod(root, 0.3, 0.18);
  const shellMat = lacquer("#5c0d0a", { metalness: 0.5, roughness: 0.22, sheen: 1, sheenColor: new THREE.Color("#ff6a3a") });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 64), shellMat);
  shell.position.y = 0.4;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.197, 64), new THREE.MeshStandardMaterial({ color: "#ece6d8", roughness: 0.85 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.481;
  const hoopGeo = new THREE.TorusGeometry(0.203, 0.009, 12, 64);
  const h1 = new THREE.Mesh(hoopGeo, chrome);
  h1.rotation.x = Math.PI / 2;
  h1.position.y = 0.48;
  const h2 = h1.clone();
  h2.position.y = 0.32;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.2015, 0.2015, 0.008, 64, 1, true), p.accent);
  stripe.position.y = 0.4;
  [shell, top, h1, h2, stripe].forEach((m) => { m.castShadow = true; root.add(m); });
  const lug = new RoundedBoxGeometry(0.016, 0.1, 0.016, 2, 0.005);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const l = new THREE.Mesh(lug, chrome);
    l.position.set(Math.cos(a) * 0.204, 0.4, Math.sin(a) * 0.204);
    l.rotation.y = -a;
    root.add(l);
  }
  // a pair of sticks playing on their own
  const wood = new THREE.MeshStandardMaterial({ color: "#d9b27a", roughness: 0.45 });
  const sticks = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.09, 0.5, 0.26);
    root.add(pivot);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.34, 10), wood);
    stick.position.set(0, 0, -0.17);
    stick.rotation.x = Math.PI / 2;
    stick.castShadow = true;
    pivot.add(stick);
    pivot.rotation.y = side * 0.25;
    return pivot;
  });
  p.anchor.set(0, 0.72, 0);
  p.move = (t, dt, beat, energy) => {
    sticks.forEach((pivot, i) => {
      const ph = beat * 2 + i * 0.5;
      const hit = Math.exp(-(ph - Math.floor(ph)) * 9);
      pivot.rotation.x = lerp(-0.35, lerp(-0.6, 0.05, hit), energy);
    });
  };
  p.shadow = contactShadow(0.6, 0.55);
  p.group.add(p.shadow);
  return alive(p);
}

export function createBass() {
  const p = base("bass", STEM_COLORS.bass, 51);
  const { root } = p;
  const s = new THREE.Shape();
  s.moveTo(0, -0.2);
  s.bezierCurveTo(0.14, -0.2, 0.19, -0.1, 0.16, 0.0);
  s.bezierCurveTo(0.14, 0.06, 0.11, 0.06, 0.12, 0.12);
  s.bezierCurveTo(0.13, 0.19, 0.08, 0.22, 0.05, 0.16);
  s.lineTo(0.03, 0.12);
  s.lineTo(-0.03, 0.12);
  s.bezierCurveTo(-0.06, 0.2, -0.13, 0.19, -0.12, 0.1);
  s.bezierCurveTo(-0.115, 0.05, -0.15, 0.04, -0.16, -0.02);
  s.bezierCurveTo(-0.19, -0.12, -0.12, -0.2, 0, -0.2);
  const bodyMat = lacquer("#6e0f0b", { metalness: 0.25, roughness: 0.2, clearcoatRoughness: 0.03 });
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 5, curveSegments: 48 }), bodyMat);
  body.position.set(0, 0.3, -0.022);
  body.castShadow = true;
  root.add(body);
  const guard = new THREE.Mesh(new THREE.ShapeGeometry(s, 32), new THREE.MeshPhysicalMaterial({ color: "#0e0b0a", roughness: 0.25, clearcoat: 1 }));
  guard.scale.setScalar(0.62);
  guard.position.set(-0.02, 0.28, 0.037);
  root.add(guard);
  const maple = new THREE.MeshPhysicalMaterial({ color: "#c99a5e", roughness: 0.4, clearcoat: 0.8 });
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.62, 0.03, 2, 0.01), maple);
  neck.position.set(0, 0.72, 0.0);
  neck.castShadow = true;
  root.add(neck);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.5, 0.006), new THREE.MeshStandardMaterial({ color: "#2a1710", roughness: 0.6 }));
  board.position.set(0, 0.75, 0.018);
  root.add(board);
  for (let i = 0; i < 12; i++) {
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.002, 0.002), chrome);
    fret.position.set(0, 0.99 - 0.5 * (1 - Math.pow(0.944, i + 1)) * 1.6, 0.022);
    root.add(fret);
  }
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.13, 0.022, 2, 0.01), maple);
  head.position.set(0, 1.08, 0);
  root.add(head);
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 12), chrome);
    k.rotation.z = Math.PI / 2;
    k.position.set(i < 2 ? -0.05 : 0.05, 1.05 + (i % 2) * 0.05, 0);
    root.add(k);
  }
  const pickup = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.035, 0.012, 2, 0.006), rubber);
  pickup.position.set(0, 0.24, 0.042);
  root.add(pickup);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.012), chrome);
  bridge.position.set(0, 0.15, 0.042);
  root.add(bridge);
  const strings = [];
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.88, 6), chrome);
    st.position.set((i - 1.5) * 0.011, 0.59, 0.03);
    root.add(st);
    strings.push(st);
  }
  // knobs lit in the track's colour
  [[0.08, 0.2], [0.1, 0.15]].forEach(([x, y]) => {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 20), p.accent);
    k.rotation.x = Math.PI / 2;
    k.position.set(x, y, 0.045);
    root.add(k);
  });
  // an A-frame guitar stand
  [-1, 1].forEach((side) => {
    const leg = rod(0.006, 0.34);
    leg.position.set(side * 0.07, 0.16, -0.06);
    leg.rotation.set(-0.25, 0, side * 0.2);
    root.add(leg);
    const cradle = rod(0.012, 0.05, rubber);
    cradle.rotation.x = Math.PI / 2;
    cradle.position.set(side * 0.1, 0.1, 0.0);
    root.add(cradle);
  });
  p.anchor.set(0, 1.25, 0);
  p.offset = 0.25;
  p.move = (t, dt, beat, energy) => {
    strings.forEach((st, i) => { st.scale.x = 1 + Math.abs(Math.sin(t * 40 + i)) * 1.5 * energy; });
  };
  p.shadow = contactShadow(0.42, 0.34);
  p.group.add(p.shadow);
  return alive(p);
}

export function createKeys() {
  const p = base("keys", STEM_COLORS.keys, 61);
  const { root } = p;
  const bodyMat = lacquer("#141214", { roughness: 0.35, metalness: 0.3 });
  const deck = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.06, 0.26, 3, 0.012), bodyMat);
  deck.position.set(0, 0.62, 0);
  deck.castShadow = true;
  root.add(deck);
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.05, 0.07, 3, 0.012), bodyMat);
  back.position.set(0, 0.66, -0.095);
  root.add(back);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.006, 0.006), p.accent);
  strip.position.set(0, 0.686, -0.06);
  root.add(strip);
  const white = new THREE.MeshPhysicalMaterial({ color: "#f3f1ea", roughness: 0.25, clearcoat: 0.6 });
  const black = new THREE.MeshPhysicalMaterial({ color: "#0c0b0e", roughness: 0.25, clearcoat: 0.6 });
  const keys = [];
  const kw = 0.62 / 17;
  for (let i = 0; i < 17; i++) {
    const k = new THREE.Mesh(new RoundedBoxGeometry(kw * 0.92, 0.018, 0.15, 2, 0.003), white);
    k.position.set(-0.31 + kw * (i + 0.5), 0.656, 0.04);
    root.add(k);
    keys.push({ m: k, y: 0.656, v: 0 });
  }
  [0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 14, 15].forEach((i) => {
    const k = new THREE.Mesh(new RoundedBoxGeometry(kw * 0.55, 0.022, 0.09, 2, 0.003), black);
    k.position.set(-0.31 + kw * (i + 1), 0.668, 0.012);
    root.add(k);
    keys.push({ m: k, y: 0.668, v: 0 });
  });
  // an X stand
  [-1, 1].forEach((side) => {
    const bar = rod(0.008, 0.78);
    bar.position.set(0, 0.3, 0);
    bar.rotation.z = side * 0.72;
    root.add(bar);
    const foot = rod(0.008, 0.26, rubber);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(side * 0.26, 0.01, 0);
    root.add(foot);
  });
  const rand = rng(62);
  p.anchor.set(0, 0.9, 0);
  p.offset = 0.5;
  p.move = (t, dt, beat, energy) => {
    for (const k of keys) {
      if (rand() < dt * 6 * energy) k.v = 1;
      k.v = Math.max(0, k.v - dt * 7);
      k.m.position.y = k.y - k.v * 0.008;
    }
  };
  p.shadow = contactShadow(0.85, 0.45);
  p.group.add(p.shadow);
  return alive(p);
}

export function createTambourine() {
  const p = base("other", STEM_COLORS.other, 71);
  const { root } = p;
  tripod(root, 0.3);
  const holder = new THREE.Group();
  holder.position.y = 0.48;
  root.add(holder);
  const woodMat = new THREE.MeshPhysicalMaterial({ color: "#7a4a24", roughness: 0.4, clearcoat: 0.8 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 20, 64), woodMat);
  ring.scale.z = 1.8;
  ring.castShadow = true;
  holder.add(ring);
  const skin = new THREE.Mesh(new THREE.CircleGeometry(0.148, 56), new THREE.MeshStandardMaterial({ color: "#e9dfc9", roughness: 0.8, side: THREE.DoubleSide }));
  holder.add(skin);
  const jingles = [];
  const jg = new THREE.CylinderGeometry(0.02, 0.02, 0.005, 20);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const j = new THREE.Mesh(jg, brass);
    j.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.03);
    j.rotation.x = Math.PI / 2;
    holder.add(j);
    jingles.push(j);
  }
  const clamp1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), steel);
  clamp1.position.y = 0.33;
  root.add(clamp1);
  p.anchor.set(0, 0.72, 0);
  p.offset = 0.75;
  p.move = (t, dt, beat, energy) => {
    const shake = Math.sin(beat * Math.PI * 4) * energy;
    holder.rotation.z = shake * 0.06;
    jingles.forEach((j, i) => { j.position.z = 0.03 + Math.abs(Math.sin(beat * Math.PI * 4 + i)) * 0.006 * energy; });
  };
  p.shadow = contactShadow(0.4, 0.3);
  p.group.add(p.shadow);
  return alive(p);
}

export function createBand() {
  return { vocals: createMic(), drums: createDrum(), bass: createBass(), keys: createKeys(), other: createTambourine() };
}

// Luxo-style lamp: base turns toward the target, the head aims at it and
// breathes. The bulb is a real spotlight.
export function createLamp({ color = "#f3ede2", light = 14 } = {}) {
  const group = new THREE.Group();
  const bodyMat = lacquer(color, { roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18, metalness: 0 });
  const turn = new THREE.Group();
  group.add(turn);
  const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 40), bodyMat);
  baseMesh.position.y = 0.015;
  baseMesh.castShadow = true;
  turn.add(baseMesh);
  const joint = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), chrome);
  const lower = new THREE.Group();
  lower.position.y = 0.035;
  turn.add(lower);
  lower.add(joint(0.022));
  const arm = (len) => {
    const g = new THREE.Group();
    [-0.012, 0.012].forEach((z) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, len, 10), bodyMat);
      rod.position.set(0, len / 2, z);
      rod.castShadow = true;
      g.add(rod);
    });
    return g;
  };
  lower.add(arm(0.3));
  const upper = new THREE.Group();
  upper.position.y = 0.3;
  lower.add(upper);
  upper.add(joint(0.018));
  upper.add(arm(0.28));
  const neck = new THREE.Group();
  neck.position.y = 0.28;
  upper.add(neck);
  neck.add(joint(0.016));
  const head = new THREE.Group();
  neck.add(head);
  const prof = [new THREE.Vector2(0.03, -0.06), new THREE.Vector2(0.036, -0.02), new THREE.Vector2(0.05, 0.0), new THREE.Vector2(0.085, 0.05), new THREE.Vector2(0.11, 0.11)];
  const shadeGeo = new THREE.LatheGeometry(prof, 48);
  shadeGeo.rotateX(Math.PI / 2);
  const shade = new THREE.Mesh(shadeGeo, new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.8, side: THREE.DoubleSide }));
  shade.castShadow = true;
  head.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe7b0").multiplyScalar(2.2) }));
  bulb.position.z = 0.03;
  head.add(bulb);
  const spot = new THREE.SpotLight("#ffc98a", light, 6, 0.75, 0.55, 1.6);
  spot.position.z = 0.02;
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  spot.shadow.radius = 6;
  head.add(spot);
  const target = new THREE.Object3D();
  target.position.z = 1;
  head.add(target);
  spot.target = target;

  lower.rotation.z = -0.35;
  upper.rotation.z = 1.25;
  const tmp = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  return {
    group,
    spot,
    bulb,
    update(t, dt, targetWorld) {
      lookAt.lerp(targetWorld, 1 - Math.exp(-dt * 3));
      group.worldToLocal(tmp.copy(lookAt));
      // The arms lean along the turntable's +X, so aim +X at the target.
      turn.rotation.y = Math.atan2(-tmp.z, tmp.x);
      const breathe = Math.sin(t * 1.1) * 0.04;
      lower.rotation.z = -0.35 + breathe;
      upper.rotation.z = 1.25 - breathe * 1.4;
      head.lookAt(lookAt);
    }
  };
}
