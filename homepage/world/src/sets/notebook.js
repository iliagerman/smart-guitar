// World 3: practice nights at your desk, with the app on a tablet: the
// practice path, the shapes ticked off as the verse loops, and the chord
// you're on, its dots lighting in and its beats counting. The metronome
// swings at full speed, the tea steams, the lamp leans in to look.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createLamp } from "../characters.js";
import { woodTexture, toTexture, glowSprite, canvas } from "../textures.js";
import { clamp } from "../util.js";

// The tablet's screen: the app's practice view, drawn on a canvas.
const SCREEN_W = 0.94;
const SCREEN_D = 0.64;
const CW = 1536;
const CH = Math.round((CW * SCREEN_D) / SCREEN_W);
const BPM = 87; // Wonderwall at full speed: the app has no slow-down step

const CHORDS = [
  { name: "Em", frets: [0, 2, 2, 0, 0, 0] },
  { name: "G", frets: [3, 2, 0, 0, 0, 3] },
  { name: "D", frets: [-1, -1, 0, 2, 3, 2] },
  { name: "A", frets: [-1, 0, 2, 2, 2, 0] }
];

// The app's colours (frontend/src/index.css).
const C = {
  night: "#07060a",
  stage: "#110e15",
  card: "#16121b",
  line: "rgba(255,255,255,0.09)",
  fire: "#f97316",
  fire4: "#fb923c",
  fire3: "#fdba74",
  flame: "#facc15",
  smoke1: "#f5f5f4",
  smoke3: "#d6d3d1",
  smoke4: "#a8a29e",
  smoke5: "#78716c",
  ok: "#16a34a"
};
const DISPLAY = "'Bebas Neue', Impact, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "Inter, system-ui, sans-serif";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Wide-tracked mono label, like the app's eyebrows; the tracking shrinks to fit `max`.
function spaced(ctx, text, x, y, max) {
  const plain = ctx.measureText(text).width;
  const track = Math.max(0, Math.min(10, (max - plain) / Math.max(1, text.length - 1)));
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
}

function fireFill(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, C.fire4);
  g.addColorStop(1, "#ea580c");
  return g;
}

// A chord diagram like the app's chord map: yellow dots on a dark board.
function diagram(ctx, chord, x, y, w, shownDots, big) {
  const gap = w / 5;
  const fret = gap * 1.25;
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = big ? 3 : 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * gap, y);
    ctx.lineTo(x + i * gap, y + fret * 4);
    ctx.stroke();
  }
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(x, y + k * fret);
    ctx.lineTo(x + w, y + k * fret);
    ctx.stroke();
  }
  ctx.strokeStyle = C.smoke1;
  ctx.lineWidth = big ? 10 : 6;
  ctx.beginPath();
  ctx.moveTo(x - 2, y);
  ctx.lineTo(x + w + 2, y);
  ctx.stroke();
  let n = 0;
  chord.frets.forEach((f, i) => {
    const cx = x + i * gap;
    if (f < 0) {
      ctx.strokeStyle = C.smoke4;
      ctx.lineWidth = big ? 5 : 3;
      const r = big ? 12 : 7;
      ctx.beginPath();
      ctx.moveTo(cx - r, y - (big ? 40 : 24) - r);
      ctx.lineTo(cx + r, y - (big ? 40 : 24) + r);
      ctx.moveTo(cx + r, y - (big ? 40 : 24) - r);
      ctx.lineTo(cx - r, y - (big ? 40 : 24) + r);
      ctx.stroke();
    } else if (f === 0) {
      ctx.strokeStyle = C.smoke3;
      ctx.lineWidth = big ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(cx, y - (big ? 40 : 24), big ? 13 : 8, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      if (n++ >= shownDots) return;
      ctx.save();
      ctx.shadowColor = "rgba(250,204,21,0.9)";
      ctx.shadowBlur = big ? 30 : 14;
      ctx.fillStyle = C.flame;
      ctx.beginPath();
      ctx.arc(cx, y + (f - 0.5) * fret, big ? gap * 0.34 : gap * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

// The whole screen for one moment: which chord, how many of its dots are in,
// which beat of it is sounding, and how far the verse loop has got.
function drawScreen(ctx, index, shownDots, beat, loop) {
  const chord = CHORDS[index];
  ctx.fillStyle = C.night;
  ctx.fillRect(0, 0, CW, CH);
  const glow = ctx.createRadialGradient(CW * 0.5, -CH * 0.1, 0, CW * 0.5, -CH * 0.1, CW * 0.7);
  glow.addColorStop(0, "rgba(249,115,22,0.32)");
  glow.addColorStop(1, "rgba(249,115,22,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CW, CH);

  // Song header
  const pad = 56;
  const art = ctx.createRadialGradient(pad + 40, pad + 40, 10, pad + 60, pad + 60, 120);
  art.addColorStop(0, "#ffb35c");
  art.addColorStop(0.6, "#c2410c");
  art.addColorStop(1, "#431407");
  ctx.fillStyle = art;
  roundRect(ctx, pad, pad, 120, 120, 22);
  ctx.fill();
  ctx.fillStyle = C.smoke1;
  ctx.font = `92px ${DISPLAY}`;
  ctx.fillText("WONDERWALL", pad + 150, pad + 78);
  ctx.fillStyle = C.smoke4;
  ctx.font = `500 34px ${SANS}`;
  ctx.fillText("Oasis", pad + 152, pad + 118);
  ctx.fillStyle = "rgba(22,163,74,0.22)";
  roundRect(ctx, pad + 262, pad + 88, 96, 40, 10);
  ctx.fill();
  ctx.fillStyle = "#86efac";
  ctx.font = `700 24px ${MONO}`;
  ctx.fillText("EASY", pad + 280, pad + 116);
  ctx.fillStyle = C.flame;
  ctx.font = `700 30px ${MONO}`;
  ctx.fillText("Em · G · D · A", pad + 378, pad + 118);

  // Left card: the practice path
  const lx = pad;
  const ly = 232;
  const lw = 640;
  ctx.fillStyle = C.card;
  roundRect(ctx, lx, ly, lw, CH - ly - 190, 36);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.fire3;
  ctx.font = `700 24px ${MONO}`;
  spaced(ctx, "LEARN THIS SONG IN 3 STEPS", lx + 36, ly + 62, lw - 72);
  const steps = [["Hear it", "done"], ["Learn it", "now"], ["On stage", ""]];
  let sx = lx + 36;
  steps.forEach(([label, state], i) => {
    const cy = ly + 128;
    ctx.fillStyle = state === "done" ? C.ok : state === "now" ? C.fire : "rgba(255,255,255,0.12)";
    if (state === "now") { ctx.save(); ctx.shadowColor = "rgba(249,115,22,0.8)"; ctx.shadowBlur = 24; }
    ctx.beginPath();
    ctx.arc(sx + 22, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    if (state === "now") ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.font = `800 24px ${SANS}`;
    ctx.textAlign = "center";
    ctx.fillText(state === "done" ? "\u2713" : String(i + 1), sx + 22, cy + 9);
    ctx.textAlign = "left";
    ctx.fillStyle = state === "now" ? "#fed7aa" : state === "done" ? C.smoke4 : C.smoke3;
    ctx.font = `700 28px ${SANS}`;
    ctx.fillText(label, sx + 56, cy + 10);
    sx += 56 + ctx.measureText(label).width + 44;
  });
  ctx.fillStyle = C.flame;
  ctx.font = `800 22px ${SANS}`;
  ctx.fillText(`\u21bb  LOOPING VERSE 1  ·  ${loop} OF 4 SHAPES DOWN`, lx + 36, ly + 214);
  // the four shapes, ticked off as the loop goes round
  const tw = (lw - 72 - 3 * 22) / 4;
  CHORDS.forEach((ch, i) => {
    const tx = lx + 36 + i * (tw + 22);
    const ty = ly + 250;
    const active = i === index;
    ctx.fillStyle = "rgba(7,6,10,0.8)";
    roundRect(ctx, tx, ty, tw, 250, 24);
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(249,115,22,0.8)" : C.line;
    ctx.lineWidth = active ? 4 : 2;
    ctx.stroke();
    ctx.fillStyle = C.flame;
    ctx.font = `800 34px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText(ch.name, tx + tw / 2, ty + 50);
    ctx.textAlign = "left";
    diagram(ctx, ch, tx + tw * 0.2, ty + 104, tw * 0.6, 9, false);
    if (i < loop) {
      ctx.fillStyle = C.ok;
      ctx.beginPath();
      ctx.arc(tx + tw - 8, ty + 8, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `800 22px ${SANS}`;
      ctx.textAlign = "center";
      ctx.fillText("\u2713", tx + tw - 8, ty + 16);
      ctx.textAlign = "left";
    }
  });

  // Right card: the chord you're playing now, its beats counting down
  const rx = lx + lw + 40;
  const rw = CW - rx - pad;
  ctx.fillStyle = C.card;
  roundRect(ctx, rx, ly, rw, CH - ly - 190, 36);
  ctx.fill();
  ctx.strokeStyle = "rgba(249,115,22,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.fire3;
  ctx.font = `700 24px ${MONO}`;
  spaced(ctx, "CHORD", rx + 40, ly + 62, rw - 80);
  ctx.save();
  ctx.shadowColor = "rgba(250,204,21,0.6)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = C.flame;
  ctx.font = `800 170px ${MONO}`;
  ctx.fillText(chord.name, rx + 36, ly + 230);
  ctx.restore();
  // beat ticks under the chord, as on the app's chord sheet
  for (let b = 0; b < 4; b++) {
    const bx = rx + 44 + b * 30;
    const lit = b <= beat;
    ctx.fillStyle = lit ? C.fire4 : "rgba(255,255,255,0.25)";
    if (lit) { ctx.save(); ctx.shadowColor = "rgba(251,146,60,0.9)"; ctx.shadowBlur = 16; }
    roundRect(ctx, bx, ly + 262 - (b === 0 ? 34 : 24), 12, b === 0 ? 34 : 24, 6);
    ctx.fill();
    if (lit) ctx.restore();
  }
  ctx.fillStyle = C.smoke4;
  ctx.font = `600 28px ${MONO}`;
  ctx.fillText(`next  ${CHORDS[(index + 1) % CHORDS.length].name}`, rx + 180, ly + 258);
  diagram(ctx, chord, rx + rw * 0.52, ly + 120, rw * 0.36, shownDots, true);

  // Player dock
  const dy = CH - 128;
  ctx.fillStyle = fireFill(ctx, pad, dy, 84, 84);
  ctx.save();
  ctx.shadowColor = "rgba(249,115,22,0.7)";
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(pad + 42, dy + 42, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.fillRect(pad + 30, dy + 26, 9, 32);
  ctx.fillRect(pad + 46, dy + 26, 9, 32);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, pad + 120, dy + 36, CW - pad * 2 - 280, 12, 6);
  ctx.fill();
  const prog = ctx.createLinearGradient(pad + 120, 0, CW - pad - 160, 0);
  prog.addColorStop(0, "#ea580c");
  prog.addColorStop(1, C.flame);
  ctx.fillStyle = prog;
  roundRect(ctx, pad + 120, dy + 36, (CW - pad * 2 - 280) * (0.18 + ((index + beat / 4) / 4) * 0.1), 12, 6);
  ctx.fill();
  ctx.fillStyle = C.smoke4;
  ctx.font = `600 28px ${MONO}`;
  ctx.fillText("0:42", CW - pad - 120, dy + 52);
}

function metronome() {
  const g = new THREE.Group();
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture({ base: "#7a3f1d", dark: "#2c1206", light: "#b0703e", seed: 31, vertical: true }), roughness: 0.4, clearcoat: 1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.07, 0.22, 4, 1), wood);
  body.rotation.y = Math.PI / 4;
  body.position.y = 0.11;
  body.castShadow = true;
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.15), new THREE.MeshStandardMaterial({ color: "#f3e6cc", roughness: 0.6 }));
  face.position.set(0, 0.11, 0.042);
  face.rotation.x = -0.23;
  g.add(face);
  const arm = new THREE.Group();
  arm.position.set(0, 0.03, 0.05);
  arm.rotation.x = -0.23;
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.17, 0.003), new THREE.MeshStandardMaterial({ color: "#d4d4d8", metalness: 1, roughness: 0.2 }));
  rod.position.y = 0.085;
  const weight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.022, 0.008), new THREE.MeshStandardMaterial({ color: "#d4a14a", metalness: 1, roughness: 0.25 }));
  weight.position.y = 0.12;
  arm.add(rod, weight);
  g.add(arm);
  return { group: g, arm };
}

function mug() {
  const g = new THREE.Group();
  const ceramic = new THREE.MeshPhysicalMaterial({ color: "#ea580c", roughness: 0.25, clearcoat: 1 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 40, 1, true), ceramic);
  cup.material.side = THREE.DoubleSide;
  cup.position.y = 0.05;
  cup.castShadow = true;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.04, 32), ceramic);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.043, 32), new THREE.MeshPhysicalMaterial({ color: "#5a2a0c", roughness: 0.05, clearcoat: 1 }));
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 0.085;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 12, 24, Math.PI * 1.3), ceramic);
  handle.position.set(0.05, 0.05, 0);
  handle.rotation.z = -Math.PI * 0.65;
  g.add(cup, bottom, tea, handle);
  return g;
}

export function createNotebook() {
  const group = new THREE.Group();
  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 3.6),
    new THREE.MeshPhysicalMaterial({ map: woodTexture({ base: "#5a3019", dark: "#1f0d05", light: "#8e5530", seed: 41, repeat: [2, 2] }), roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.25 })
  );
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  group.add(desk);

  // The tablet: a dark slab, and its screen showing the app.
  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(SCREEN_W + 0.06, 0.02, SCREEN_D + 0.06, 4, 0.012),
    new THREE.MeshPhysicalMaterial({ color: "#16131a", roughness: 0.35, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.2 })
  );
  slab.position.y = 0.01;
  slab.castShadow = slab.receiveShadow = true;
  group.add(slab);
  const [screenC, sctx] = canvas(CW, CH);
  const screenTex = toTexture(screenC);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_D), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0205;
  group.add(screen);
  // a sheen across the glass
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_D), new THREE.MeshPhysicalMaterial({ color: "#000", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1 }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = 0.021;
  group.add(glass);

  const met = metronome();
  met.group.position.set(0.72, 0, -0.32);
  met.group.rotation.y = -0.45;
  group.add(met.group);
  const cup = mug();
  cup.position.set(-0.7, 0, -0.18);
  group.add(cup);

  // A guitar pick left on the desk.
  const pk = new THREE.Shape();
  pk.moveTo(0, 0.02);
  pk.quadraticCurveTo(0.022, 0.02, 0.018, 0.0);
  pk.quadraticCurveTo(0.01, -0.02, 0, -0.026);
  pk.quadraticCurveTo(-0.01, -0.02, -0.018, 0.0);
  pk.quadraticCurveTo(-0.022, 0.02, 0, 0.02);
  const pick = new THREE.Mesh(new THREE.ExtrudeGeometry(pk, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2 }), new THREE.MeshPhysicalMaterial({ color: "#f97316", roughness: 0.2, clearcoat: 1, transmission: 0.2 }));
  pick.rotation.set(-Math.PI / 2, 0, 0.6);
  pick.position.set(0.62, 0.002, 0.22);
  pick.castShadow = true;
  group.add(pick);

  // Steam.
  const steamTex = glowSprite();
  const steam = Array.from({ length: 14 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, color: "#fff4e6", transparent: true, opacity: 0, depthWrite: false }));
    s.userData.seed = i / 14;
    group.add(s);
    return s;
  });

  const lamp = createLamp({ light: 2.6 });
  lamp.group.position.set(-0.85, 0, -0.85);
  group.add(lamp.group);
  group.add(new THREE.HemisphereLight("#4b5aa3", "#2b160b", 0.5));
  const cool = new THREE.PointLight("#7aa2ff", 2.5, 4, 1.5);
  cool.position.set(1.2, 0.9, 0.6);
  group.add(cool);

  const lampTarget = new THREE.Vector3();
  let drawn = "";
  // Redraw once the display font has loaded.
  document.fonts.ready.then(() => { drawn = ""; });

  return {
    name: "notebook",
    group,
    background: new THREE.Color("#140b07"),
    fog: new THREE.Fog("#140b07", 3, 7),
    environment: 0.3,
    bloom: 0.3,
    update(t, dt) {
      const beat = (t * BPM) / 60;
      // one chord a bar: its dots light in on beat one, a tick per beat
      const bar = beat / 4;
      const index = Math.floor(bar) % CHORDS.length;
      const inChord = beat - Math.floor(bar) * 4; // beats into this chord (0..4)
      const fretted = CHORDS[index].frets.filter((f) => f > 0).length;
      const shown = Math.min(fretted, Math.floor((inChord / 0.8) * fretted) + 1);
      const tick = Math.floor(inChord);
      const loop = 2 + (Math.floor(bar / CHORDS.length) % 2);
      const key = `${index}:${shown}:${tick}:${loop}`;
      if (key !== drawn) {
        drawScreen(sctx, index, shown, tick, loop);
        screenTex.needsUpdate = true;
        drawn = key;
      }
      // metronome swings once per beat
      met.arm.rotation.z = Math.sin(beat * Math.PI) * 0.42;
      // steam curls up from the mug
      steam.forEach((s) => {
        const life = (t * 0.22 + s.userData.seed) % 1;
        s.position.set(-0.7 + Math.sin(life * 6 + s.userData.seed * 20) * 0.03 * life, 0.1 + life * 0.35, -0.18 + Math.cos(life * 5) * 0.02);
        const sc = 0.04 + life * 0.12;
        s.scale.set(sc, sc, sc);
        s.material.opacity = Math.sin(life * Math.PI) * 0.22;
      });
      lampTarget.set(0.25 + Math.sin(t * 0.4) * 0.05, 0.02, 0);
      lamp.update(t, dt, group.localToWorld(lampTarget));
    }
  };
}
