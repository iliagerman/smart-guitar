// The band as people: a singer, guitarist, bassist, drummer, keyboard player
// and percussionist, lit like a concert photo (dark figures cut out by
// backlight). Bodies are smooth lathe-turned limbs on a joint rig; arms are
// solved with two-bone IK so hands really hold the neck, the pick, the mic,
// the keys and the sticks; hair is thousands of strands that catch the light.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { clamp, lerp, rng } from "./util.js";
import { canvas, toTexture } from "./textures.js";
import { createGuitar } from "./guitar.js";

const chrome = new THREE.MeshStandardMaterial({ color: "#e6e6ea", metalness: 1, roughness: 0.18 });
const steel = new THREE.MeshStandardMaterial({ color: "#2a2a2f", metalness: 0.85, roughness: 0.35 });
const brass = new THREE.MeshStandardMaterial({ color: "#6a4b22", metalness: 0.9, roughness: 0.62 });
const drumHead = figure(new THREE.MeshStandardMaterial({ color: "#5a534b", roughness: 0.85 }));
const rubber = new THREE.MeshStandardMaterial({ color: "#0d0d10", roughness: 0.8 });
const TAU = Math.PI * 2;

export const NOISE = `
  float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ v += a*n3(p); p *= 2.03; a *= 0.5; } return v; }
  vec3 fireRamp(float f){
    vec3 c = mix(vec3(0.06,0.01,0.0), vec3(0.6,0.06,0.0), smoothstep(0.0, 0.3, f));
    c = mix(c, vec3(1.0,0.35,0.03), smoothstep(0.25, 0.55, f));
    c = mix(c, vec3(1.0,0.66,0.16), smoothstep(0.5, 0.8, f));
    return mix(c, vec3(1.0,0.92,0.6), smoothstep(0.82, 1.0, f));
  }`;

// The figure of fire: flames flowing up over the body, brightest at the rim,
// appearing from the feet up as uReveal goes 0 -> 1.
export function fireMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uReveal, uBase; varying vec3 vW; varying vec3 vN;
      ${NOISE}
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float fres = 1.0 - abs(dot(normalize(vN), v));
        float flow = fbm3(vec3(vW.x*5.0, vW.y*3.0 - uTime*2.4, vW.z*5.0));
        float h = vW.y - uBase;
        float edge = uReveal * 2.3 - 0.1 + (flow - 0.5) * 0.35;
        if (h > edge) discard;
        float f = clamp(0.18 + fres*fres*0.9 + (flow - 0.45)*0.9, 0.0, 1.0);
        vec3 col = fireRamp(f) * (0.55 + fres*0.9);
        col += vec3(1.0, 0.6, 0.25) * smoothstep(0.12, 0.0, edge - h) * 1.5;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}

// Concert-photo shading for the band: the surface stays dark and a warm rim
// of backlight traces every outline. With `burn`, the material can also burn
// away into embers as burn.uBurn goes 0 -> 1.
export const RIM = { uRim: { value: new THREE.Color("#ffb86b") }, uRimStrength: { value: 1.1 } };
export function figure(mat, burn = null, bump = 0, bumpScale = 20, face = null) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM.uRim;
    sh.uniforms.uRimStrength = RIM.uRimStrength;
    sh.uniforms.uBump = { value: bump };
    sh.uniforms.uBumpScale = { value: bumpScale };
    sh.vertexShader = "varying vec3 vObjPos;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vObjPos = transformed;");
    let head = "uniform vec3 uRim; uniform float uRimStrength; uniform float uBump; uniform float uBumpScale; varying vec3 vObjPos;\n" + NOISE + "\n";
    let tail = `
      vec3 nv = normalize(normal);
      float rim = 1.0 - clamp(dot(nv, normalize(vViewPosition)), 0.0, 1.0);
      // the backlight sits high behind the band, so only upward-facing edges catch it
      float lit = smoothstep(-0.2, 0.7, nv.y);
      gl_FragColor.rgb += uRim * pow(rim, 4.0) * lit * uRimStrength;`;
    if (burn) {
      sh.uniforms.uBurn = burn.uBurn;
      sh.vertexShader = "varying vec3 vBurnPos;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vBurnPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      head += "uniform float uBurn; varying vec3 vBurnPos;\n";
      tail += `
      float bn = fbm3(vBurnPos * 7.0);
      float bd = bn - (uBurn * 1.3 - 0.15);
      if (bd < 0.0) discard;
      gl_FragColor.rgb += vec3(1.0, 0.42, 0.06) * smoothstep(0.1, 0.0, bd) * 8.0 * step(0.001, uBurn);`;
    }
    // folds and creases: bend the shading normal with noise stuck to the body
    const wrinkle = `#include <normal_fragment_maps>
      {
        vec3 wp = vObjPos * uBumpScale;
        vec2 fold = vec2(fbm3(wp) - 0.5, fbm3(wp * vec3(1.0, 0.35, 1.0) + 3.7) - 0.5);
        vec3 bent = normal + vec3(fold, 0.0) * uBump;
        if (dot(bent, bent) > 1e-4) normal = normalize(bent);
      }`;
    let frag = sh.fragmentShader;
    if (face) {
      sh.uniforms.uBrow = { value: new THREE.Color(face.brow) };
      sh.uniforms.uLips = { value: new THREE.Color(face.lips) };
      sh.uniforms.uIris = { value: new THREE.Color(face.iris || "#3a2414") };
      head += "uniform vec3 uBrow; uniform vec3 uLips; uniform vec3 uIris;\n";
      frag = frag.replace("#include <color_fragment>", "#include <color_fragment>\n" + FACE_PAINT);
    }
    sh.fragmentShader = head + frag.replace("#include <normal_fragment_maps>", wrinkle).replace("#include <dithering_fragment>", "#include <dithering_fragment>" + tail);
  };
  mat.customProgramCacheKey = () => (burn ? "figure-burn" : "figure") + (face ? "-face" : "");
  return mat;
}

// Painted in the skin shader on the sculpted head (object space, face toward
// +z): soft almond eyes with iris and lid shadow, arched brows, lips, a touch
// of warmth in the cheeks. Painting keeps the features part of the skin.
const FACE_PAINT = `
  {
    vec3 q = vObjPos;
    float front = smoothstep(0.035, 0.075, q.z);
    vec3 skin = diffuseColor.rgb;
    vec2 ck = vec2((abs(q.x) - 0.046) / 0.02, (q.y + 0.024) / 0.018);
    skin = mix(skin, skin * vec3(1.1, 0.9, 0.86), exp(-dot(ck, ck)) * 0.45 * front);
    vec2 e = vec2(abs(q.x) - 0.034, q.y - 0.008);
    vec2 es = e * vec2(1.0 / 0.0125, 1.0 / 0.0058);
    float almond = length(es) + es.x * es.x * 0.12;
    float so = length(e * vec2(48.0, 62.0));
    skin *= 1.0 - 0.07 * exp(-so * so) * front;
    // a thin lash line along the upper lid
    float lid = smoothstep(0.9, 1.0, almond) * smoothstep(1.18, 1.02, almond) * step(0.0005, e.y);
    skin = mix(skin, skin * 0.55, lid * front);
    vec3 eyeCol = vec3(0.9, 0.86, 0.82);
    eyeCol = mix(eyeCol, uIris, smoothstep(0.005, 0.004, length(e + vec2(0.0, 0.0006))));
    eyeCol = mix(eyeCol, vec3(0.03), smoothstep(0.0017, 0.0011, length(e + vec2(0.0, 0.0006))));
    skin = mix(skin, eyeCol, smoothstep(1.0, 0.82, almond) * front);
    float bx = (abs(q.x) - 0.035) / 0.021;
    float by = q.y - (0.027 + 0.004 * (1.0 - bx * bx)) + (abs(q.x) - 0.035) * 0.06;
    skin = mix(skin, uBrow, smoothstep(1.0, 0.75, abs(bx)) * smoothstep(0.0034, 0.0018, abs(by)) * front * 0.9);
    float lx = q.x / 0.022;
    float ly = (q.y + 0.051) / 0.0068;
    skin = mix(skin, uLips, smoothstep(1.0, 0.8, lx * lx + ly * ly) * front * 0.75);
    skin = mix(skin, skin * 0.4, smoothstep(1.0, 0.8, abs(lx)) * smoothstep(0.0013, 0.0004, abs(q.y + 0.0508)) * front);
    diffuseColor.rgb = skin;
  }`;

// The head as one sculpted surface: nose, brow, eye sockets, cheekbones,
// lips and chin pushed out of a sphere, with the jaw tapering to the chin.
function headGeometry() {
  const g = new THREE.SphereGeometry(0.1, 72, 54);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const bump = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.set(v.x * 0.96, v.y * 1.2, v.z * 1.06);
    const jaw = clamp((-v.y - 0.01) / 0.11);
    v.x *= 1 - 0.24 * jaw;
    if (v.z > 0) {
      v.z *= 1 - 0.06 * jaw;
      const { x, y } = v;
      let dz = 0.02 * bump(x, y, 0, -0.016, 0.011, 0.024) + 0.006 * bump(x, y, 0, -0.035, 0.016, 0.008);
      dz += 0.003 * bump(x, y, 0, 0.03, 0.05, 0.011);
      dz -= 0.0025 * (bump(x, y, 0.034, 0.008, 0.015, 0.009) + bump(x, y, -0.034, 0.008, 0.015, 0.009));
      dz += 0.004 * (bump(x, y, 0.05, -0.022, 0.02, 0.018) + bump(x, y, -0.05, -0.022, 0.02, 0.018));
      dz += 0.0035 * bump(x, y, 0, -0.05, 0.02, 0.007);
      dz += 0.007 * bump(x, y, 0, -0.1, 0.022, 0.018);
      v.z += dz * clamp(v.z / 0.05);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Fabric, drawn on canvases: flannel plaid, denim twill, and a printed tee.
function plaid(base, line, stripe) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = line;
  [[0, 56], [128, 30]].forEach(([at, w]) => { ctx.fillRect(at, 0, w, 256); ctx.fillRect(0, at, 256, w); });
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = stripe;
  [96, 224].forEach((at) => { ctx.fillRect(at, 0, 5, 256); ctx.fillRect(0, at, 256, 5); });
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: [3, 3] });
}
function denim(base) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const rand = rng(33);
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.strokeStyle = rand() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y + 6);
    ctx.stroke();
  }
  return toTexture(c, { repeat: [2, 3] });
}
function tee(base, ink, print = "ROCK") {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);
  // a band print on the chest: the lathe's u = 0 faces front, so draw it
  // across the seam at both edges
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 7;
  ctx.font = "36px 'Bebas Neue', Impact, sans-serif";
  ctx.textAlign = "center";
  if (print) [0, 512].forEach((x) => {
    ctx.beginPath();
    ctx.arc(x, 150, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(print, x, 162);
  });
  return toTexture(c);
}
export const CLOTH = { plaid, denim, tee };

// One musician's outfit. Every material rim-lights, crumples and can burn.
export function wardrobe({ shirt = "#2a2522", shirtMap = null, skin = "#b27a55", pants = "#1d2433", pantsMap = null, jacket = null, jacketMap = null, jacketRough = 0.45, hair = "#120c09", iris = "#3a2414", burn = null } = {}) {
  const std = (color, rough, map, bump, scale, extra = {}) => figure(new THREE.MeshStandardMaterial({ color: map ? "#ffffff" : color, map, roughness: rough, ...extra }), burn, bump, scale);
  return {
    shirt: std(shirt, 0.85, shirtMap, 0.9, 18, { side: THREE.DoubleSide }),
    skin: std(skin, 0.48, null, 0.08, 60),
    pants: std(pants, 0.9, pantsMap, 0.8, 14, { side: THREE.DoubleSide }),
    hair: std(hair, 0.55, null, 1.4, 90),
    jacket: jacket || jacketMap ? std(jacket, jacketRough, jacketMap, 0.7, 11, { side: THREE.DoubleSide }) : null,
    face: figure(new THREE.MeshStandardMaterial({ color: skin, roughness: 0.48 }), burn, 0.05, 60, {
      brow: new THREE.Color(hair).multiplyScalar(0.8).getStyle(),
      lips: new THREE.Color(skin).multiplyScalar(0.78).offsetHSL(-0.01, 0.1, 0).getStyle(),
      iris: iris
    }),
    strands: hairMaterial(burn, hair)
  };
}

function mesh(geo, mat, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// A limb turned on a lathe, hanging down from its joint: `prof` is a list of
// [t, radius] from the joint (t = 0) to the far end (t = 1), with round caps.
function organ(parent, len, prof, mat, seg = 16) {
  const pts = [];
  const rEnd = prof[prof.length - 1][1];
  const r0 = prof[0][1];
  for (let i = 3; i >= 1; i--) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(rEnd * Math.cos(a), -len - rEnd * 0.7 * Math.sin(a)));
  }
  for (let i = prof.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(prof[i][1], -prof[i][0] * len));
  for (let i = 1; i <= 3; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r0 * Math.cos(a), r0 * 0.8 * Math.sin(a)));
  }
  pts.unshift(new THREE.Vector2(0.0005, -len - rEnd * 0.7));
  pts.push(new THREE.Vector2(0.0005, r0 * 0.8));
  return mesh(new THREE.LatheGeometry(pts, seg), mat, parent);
}

// Hair as strands: line segments rooted on the scalp, combed by style and
// gravity, swaying a little. Backlight catches their tips and edges.
export function hairMaterial(burn = null, color = "#120c09") {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: HAIR_TIME, uRim: RIM.uRim, uBurn: burn ? burn.uBurn : { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `attribute float tip; attribute float seed; uniform float uTime; varying float vTip; varying float vEdge; varying vec3 vW;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*1.7 + seed*6.28) * 0.01 * tip * tip;
        p.z += cos(uTime*1.3 + seed*4.0) * 0.006 * tip * tip;
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        vec3 n = normalize(mat3(viewMatrix) * mat3(modelMatrix) * (position - vec3(0.0, 0.1, 0.0)));
        vec4 mv = viewMatrix * w;
        vEdge = clamp(1.0 - abs(dot(n, normalize(-mv.xyz))), 0.0, 1.0); // pow() of a negative is NaN
        vTip = tip;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uRim; uniform vec3 uColor; uniform float uBurn; varying float vTip; varying float vEdge; varying vec3 vW;
      ${NOISE}
      void main(){
        if (uBurn > 0.001 && fbm3(vW * 7.0) < uBurn * 1.3 - 0.15) discard;
        float lit = pow(vEdge, 2.5) * (0.35 + 0.65 * vTip);
        vec3 col = mix(uColor * 0.55, uRim * 1.3, lit);
        gl_FragColor = vec4(col, 0.85);
      }`,
    transparent: true
  });
}
const HAIR_TIME = { value: 0 };
export function tickHair(t) { HAIR_TIME.value = t; }

const _fall = new THREE.Vector3();
const _comb = new THREE.Vector3();
function strands(head, style, mat, seed) {
  const rand = rng(seed);
  const n = style === "long" ? 1400 : style === "curly" ? 1500 : 900;
  const K = style === "long" ? 8 : 4;
  const C = new THREE.Vector3(0, 0.1, 0);
  const R = new THREE.Vector3(0.102, 0.126, 0.112);
  const pos = [];
  const tipA = [];
  const seedA = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let s = 0; s < n; s++) {
    // a root on the upper and back part of the skull, never on the face
    const u = rand() * TAU;
    const v = Math.acos(1 - rand() * (style === "cap" ? 1.1 : 1.25));
    d.set(Math.sin(v) * Math.sin(u), Math.cos(v), Math.sin(v) * Math.cos(u));
    if (d.z > 0.35 && d.y < 0.55) { s--; continue; }
    // long hair falls from the crown, sides and back, clear of the face
    if (style === "long" && d.z > 0.05 && d.y < 0.75) { s--; continue; }
    if (style === "cap" && d.y > 0.25) { s--; continue; }
    if ((style === "short" || style === "curly") && d.z > 0.2 && d.y < 0.8) { s--; continue; }
    p.set(C.x + d.x * R.x, C.y + d.y * R.y, C.z + d.z * R.z);
    const len = style === "long" ? 0.24 + rand() * 0.16 : style === "curly" ? 0.05 + rand() * 0.03 : style === "cap" ? 0.03 + rand() * 0.025 : 0.02 + rand() * 0.02;
    const seg = len / K;
    const sd = rand();
    let prev = p.clone();
    const dir = d.clone();
    // long hair from the front of the head is swept to the side, behind the ears
    if (style === "long" && d.z > -0.1) dir.set(Math.sign(d.x || 1) * 0.9, 0.25, -0.55).normalize();
    for (let k = 1; k <= K; k++) {
      // long hair drops with gravity; short hair lies back along the scalp
      if (style === "long") dir.lerp(_fall.set(Math.sign(d.x || 1) * Math.min(1, Math.abs(d.x) * 2) * 0.35, -1, -0.4), 0.3 + k * 0.1).normalize();
      else if (style !== "curly") dir.lerp(_comb.set(d.x * 0.3, -0.45, -1), 0.8).normalize();
      if (style === "curly") {
        // tight coils that stay close to the head
        dir.lerp(_comb.set(d.x * 0.5, -0.2, -0.6), 0.3);
        dir.add(q.set(Math.sin(k * 2.6 + sd * 9) * 0.9, Math.cos(k * 2.6 + sd * 7) * 0.5, Math.cos(k * 2.6 + sd * 5) * 0.9)).normalize();
      }
      const next = prev.clone().addScaledVector(dir, seg);
      // keep strands outside the skull
      q.copy(next).sub(C).divide(R);
      if (q.length() < (style === "long" ? 1.06 : 1.02)) next.copy(C).add(q.normalize().multiplyScalar(style === "long" ? 1.06 : 1.02).multiply(R));
      pos.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
      tipA.push((k - 1) / K, k / K);
      seedA.push(sd, sd);
      prev = next;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("tip", new THREE.Float32BufferAttribute(tipA, 1));
  geo.setAttribute("seed", new THREE.Float32BufferAttribute(seedA, 1));
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  head.add(lines);
  return lines;
}

// A hand with a palm, four two-part fingers and a thumb; curl(0..1) closes it.
function hand(parent, side, w) {
  const g = new THREE.Group();
  parent.add(g);
  const palm = mesh(new RoundedBoxGeometry(0.068, 0.08, 0.026, 2, 0.011), w.skin, g);
  palm.position.y = -0.04;
  const joints = [];
  [-0.023, -0.008, 0.007, 0.022].forEach((x, i) => {
    const k1 = new THREE.Group();
    k1.position.set(x * side, -0.08, 0);
    g.add(k1);
    organ(k1, 0.034 - Math.abs(i - 1.5) * 0.003, [[0, 0.0085], [1, 0.008]], w.skin, 8);
    const k2 = new THREE.Group();
    k2.position.y = -0.036;
    k1.add(k2);
    organ(k2, 0.026, [[0, 0.0078], [1, 0.0068]], w.skin, 8);
    joints.push(k1, k2);
  });
  const thumb = new THREE.Group();
  thumb.position.set(-0.03 * side, -0.03, 0.012);
  thumb.rotation.set(-0.5, 0, -0.7 * side);
  g.add(thumb);
  organ(thumb, 0.045, [[0, 0.011], [1, 0.0085]], w.skin, 8);
  return {
    group: g,
    curl(v) {
      for (let i = 0; i < joints.length; i++) joints[i].rotation.x = -v * (i % 2 ? 1.4 : 1.1);
      thumb.rotation.x = -0.5 - v * 0.6;
    }
  };
}

// A person facing +z, standing with feet on y = 0. Returns the joints.
export function person(w, { hair: style = "short", build = 1, seed = 1, beard = false } = {}) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);
  const pelvis = mesh(new THREE.SphereGeometry(0.155, 20, 14), w.pants, hips);
  pelvis.scale.set(1, 0.72, 0.74);
  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  // shirt: loose at the hem, chest and back, broad shoulders
  const profile = [[0.001, -0.07], [0.168, -0.07], [0.16, 0.06], [0.155, 0.16], [0.172, 0.3], [0.196, 0.42], [0.2, 0.49], [0.17, 0.54], [0.1, 0.58], [0.05, 0.595], [0.001, 0.6]];
  const torsoGeo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * build, y)), 28);
  torsoGeo.scale(1, 1, 0.64);
  mesh(torsoGeo, w.shirt, spine);
  // chest in front, shoulder blades behind, so the torso is not a tube
  const chest = mesh(new THREE.SphereGeometry(0.1, 18, 12), w.shirt, spine);
  chest.scale.set(1.75 * build, 0.85, 0.7);
  chest.position.set(0, 0.4, 0.055);
  const blades = mesh(new THREE.SphereGeometry(0.1, 18, 12), w.shirt, spine);
  blades.scale.set(1.7 * build, 0.9, 0.6);
  blades.position.set(0, 0.42, -0.05);
  if (w.jacket) {
    // an open jacket over the shirt: the lathe leaves a gap at the front
    const jp = [[0.001, -0.13], [0.178, -0.13], [0.172, 0.05], [0.168, 0.16], [0.185, 0.3], [0.21, 0.42], [0.216, 0.49], [0.182, 0.545], [0.11, 0.59], [0.07, 0.63]];
    const jg = new THREE.LatheGeometry(jp.map(([r, y]) => new THREE.Vector2(r * build, y)), 28, 0.42, TAU - 0.84);
    jg.scale(1, 1, 0.68);
    mesh(jg, w.jacket, spine);
  }
  // trapezius: the slope from the neck down to the shoulders
  const traps = mesh(new THREE.SphereGeometry(0.1, 18, 10), w.jacket || w.shirt, spine);
  traps.scale.set(2.05 * build, 0.55, 1.05);
  traps.position.set(0, 0.54, -0.01);
  const neck = new THREE.Group();
  neck.position.y = 0.575;
  spine.add(neck);
  organ(neck, 0.11, [[0, 0.046], [1, 0.05]], w.skin, 12).rotation.x = Math.PI;
  const head = new THREE.Group();
  head.position.y = 0.1;
  neck.add(head);
  const skull = mesh(headGeometry(), w.face || w.skin, head);
  skull.position.y = 0.1;
  [-1, 1].forEach((sx) => {
    const ear = mesh(new THREE.SphereGeometry(0.022, 10, 8), w.skin, head);
    ear.scale.set(0.42, 1.1, 0.75);
    ear.position.set(sx * 0.092, 0.095, -0.008);
  });
  const face = [];
  if (beard) {
    const b1 = mesh(new THREE.SphereGeometry(0.068, 16, 12), w.hair, head);
    b1.scale.set(1.08, 0.95, 1.02);
    b1.position.set(0, 0.022, 0.04);
  }
  const scalp = mesh(new THREE.SphereGeometry(0.104, 20, 12, 0, TAU, 0, Math.PI * 0.56), w.hair, head);
  scalp.scale.set(1, 1.24, 1.1);
  scalp.position.set(0, 0.106, -0.012);
  // tipped back so the hairline sits high on the forehead
  scalp.rotation.x = -0.42;
  if (style === "long") {
    const fall = mesh(new THREE.SphereGeometry(0.12, 18, 14), w.hair, head);
    fall.scale.set(0.9, 1.45, 0.5);
    fall.position.set(0, 0.0, -0.075);
  } else if (style === "curly") {
    const mop = mesh(new THREE.IcosahedronGeometry(0.125, 2), w.hair, head);
    mop.scale.set(1.05, 0.92, 1.02);
    mop.position.set(0, 0.15, -0.02);
  } else if (style === "cap") {
    const cap = mesh(new THREE.SphereGeometry(0.113, 20, 10, 0, TAU, 0, Math.PI * 0.5), w.shirt, head);
    cap.scale.set(1, 1.05, 1.08);
    cap.position.set(0, 0.125, -0.004);
    const brim = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), w.shirt, head);
    brim.scale.set(0.95, 1, 1.3);
    brim.position.set(0, 0.14, 0.07);
    brim.rotation.x = 0.12;
  }
  const hairLines = strands(head, style, w.strands, seed * 7 + 3);
  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.19 * build, 0.5, 0);
    spine.add(shoulder);
    mesh(new THREE.SphereGeometry((w.jacket ? 0.074 : 0.066) * build, 16, 12), w.jacket || w.shirt, shoulder).scale.set(1, 0.95, 0.95);
    organ(shoulder, 0.29, [[0, 0.05 * build], [0.35, 0.049 * build], [0.8, 0.039], [1, 0.037]], w.skin);
    // T-shirt sleeve over the upper arm
    if (!w.jacket) {
      const sleeve = mesh(new THREE.CylinderGeometry(0.062 * build, 0.07 * build, 0.16, 18, 1, true).translate(0, -0.07, 0), w.shirt, shoulder);
      sleeve.scale.z = 0.95;
    }
    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    organ(elbow, 0.255, [[0, 0.038], [0.22, 0.042], [0.7, 0.032], [1, 0.026]], w.skin);
    if (w.jacket) {
      // jacket sleeves down to the wrist
      mesh(new THREE.CylinderGeometry(0.074 * build, 0.064, 0.31, 18, 1, true).translate(0, -0.14, 0), w.jacket, shoulder);
      mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.25, 18, 1, true).translate(0, -0.1, 0), w.jacket, elbow);
      // the elbow of the sleeve, so it stays closed when the arm bends
      mesh(new THREE.SphereGeometry(0.064, 16, 12), w.jacket, elbow);
    }
    const wrist = new THREE.Group();
    wrist.position.y = -0.26;
    elbow.add(wrist);
    const h = hand(wrist, side, w);
    return { shoulder, elbow, wrist, hand: h.group, curl: h.curl, side };
  };
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.092, -0.03, 0);
    hips.add(hip);
    organ(hip, 0.45, [[0, 0.09], [0.15, 0.085], [0.6, 0.068], [1, 0.056]], w.pants);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    organ(knee, 0.43, [[0, 0.056], [0.3, 0.058], [0.8, 0.05], [1, 0.05]], w.pants);
    // shoe: toe box and sole
    const shoe = mesh(new RoundedBoxGeometry(0.1, 0.075, 0.27, 3, 0.03), rubber, knee);
    shoe.position.set(0, -0.455, 0.055);
    const sole = mesh(new RoundedBoxGeometry(0.108, 0.02, 0.28, 2, 0.008), steel, knee);
    sole.position.set(0, -0.49, 0.055);
    return { hip, knee };
  };
  // the character's left is +x (they face the camera)
  return { root, hips, spine, neck, head, hairLines, face, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1) };
}

// Two-bone IK: turns shoulder and elbow so the wrist reaches `target`, with
// the elbow bending toward `pole` (both in world space).
const DOWN = new THREE.Vector3(0, -1, 0);
const _S = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _E = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
function reach(arm, target, pole, a = 0.29, b = 0.26) {
  arm.shoulder.getWorldPosition(_S);
  _d.copy(target).sub(_S);
  const dist = clamp(_d.length(), 0.08, (a + b) * 0.999);
  _d.normalize();
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).sub(_S);
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  _E.copy(_S).addScaledVector(_d, cosA * a).addScaledVector(_p, sinA * a);
  _u.copy(_E).sub(_S).normalize();
  _q.setFromUnitVectors(DOWN, _u);
  arm.shoulder.parent.getWorldQuaternion(_pq);
  arm.shoulder.quaternion.copy(_pq.invert().multiply(_q));
  _u.copy(_S).addScaledVector(_d, dist).sub(_E).normalize();
  _q.setFromUnitVectors(DOWN, _u);
  arm.shoulder.getWorldQuaternion(_pq);
  arm.elbow.quaternion.copy(_pq.invert().multiply(_q));
}

// Turns a wrist so the hand's fingers point along `fingers` and its palm faces
// `palm` (world directions). The hand hangs along its -y with the palm on +z.
const _hx = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _hz = new THREE.Vector3();
const _hm = new THREE.Matrix4();
const _hq = new THREE.Quaternion();
function orientHand(arm, fingers, palm) {
  _hy.copy(fingers).negate().normalize();
  _hz.copy(palm).addScaledVector(_hy, -palm.dot(_hy)).normalize();
  _hx.crossVectors(_hy, _hz);
  _hm.makeBasis(_hx, _hy, _hz);
  _hq.setFromRotationMatrix(_hm);
  arm.wrist.parent.getWorldQuaternion(_pq);
  arm.wrist.quaternion.copy(_pq.invert().multiply(_hq));
}

// Where an arm's elbow should point, in the body's space: down, out and back.
const _pole = new THREE.Vector3();
function poleFor(r, arm, x = 0.35, y = -0.45, z = -0.25) {
  return r.spine.localToWorld(_pole.set(arm.side * x, y + 0.5, z));
}

// Solid-body electric guitar or bass, body at the origin, neck along +y.
function bodyShape(s) {
  const p = new THREE.Shape();
  p.moveTo(0, -0.2 * s);
  p.bezierCurveTo(0.14 * s, -0.2 * s, 0.19 * s, -0.1 * s, 0.16 * s, 0.0);
  p.bezierCurveTo(0.14 * s, 0.06 * s, 0.11 * s, 0.06 * s, 0.12 * s, 0.12 * s);
  p.bezierCurveTo(0.13 * s, 0.19 * s, 0.08 * s, 0.22 * s, 0.05 * s, 0.16 * s);
  p.lineTo(0.03 * s, 0.12 * s);
  p.lineTo(-0.03 * s, 0.12 * s);
  p.bezierCurveTo(-0.06 * s, 0.2 * s, -0.13 * s, 0.19 * s, -0.12 * s, 0.1 * s);
  p.bezierCurveTo(-0.115 * s, 0.05 * s, -0.15 * s, 0.04 * s, -0.16 * s, -0.02 * s);
  p.bezierCurveTo(-0.19 * s, -0.12 * s, -0.12 * s, -0.2 * s, 0, -0.2 * s);
  return p;
}

export function electric({ bass = false, finish, mats = null } = {}) {
  const g = new THREE.Group();
  const s = bass ? 1.05 : 0.9;
  const neckLen = bass ? 0.78 : 0.56;
  const m = mats || {
    body: figure(new THREE.MeshPhysicalMaterial({ color: finish, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })),
    neck: figure(new THREE.MeshStandardMaterial({ color: "#3a2214", roughness: 0.55 })),
    metal: chrome,
    guard: new THREE.MeshPhysicalMaterial({ color: "#0c0a09", roughness: 0.3, clearcoat: 1 })
  };
  const body = mesh(new THREE.ExtrudeGeometry(bodyShape(s), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3, curveSegments: 32 }), m.body, g);
  body.position.z = -0.02;
  const guard = mesh(new THREE.ShapeGeometry(bodyShape(s * 0.6), 16), m.guard, g);
  guard.position.set(-0.015, -0.02, 0.032);
  const neck = mesh(new RoundedBoxGeometry(bass ? 0.05 : 0.045, neckLen, 0.025, 2, 0.008), m.neck, g);
  neck.position.set(0, 0.1 * s + neckLen / 2, 0.01);
  const headstock = mesh(new RoundedBoxGeometry(0.07, 0.15, 0.02, 2, 0.008), m.neck, g);
  headstock.position.set(0.006, 0.1 * s + neckLen + 0.07, 0.005);
  headstock.rotation.x = -0.12;
  const pickup = mesh(new THREE.BoxGeometry(0.08, 0.025, 0.012), m.metal, g);
  pickup.position.set(0, -0.02, 0.04);
  const bridge = mesh(new THREE.BoxGeometry(0.075, 0.02, 0.012), m.metal, g);
  bridge.position.set(0, -0.1 * s, 0.04);
  const strings = mesh(new THREE.PlaneGeometry(0.03, neckLen + 0.2 * s), new THREE.MeshBasicMaterial({ color: "#cfcfcf", transparent: true, opacity: 0.35 }), g);
  strings.position.set(0, (neckLen + 0.1 * s) / 2 - 0.05, 0.03);
  return g;
}

function micStand(parent, height) {
  const g = new THREE.Group();
  parent.add(g);
  const pole = mesh(new THREE.CylinderGeometry(0.01, 0.01, height, 10), steel, g);
  pole.position.y = height / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    const foot = new THREE.Vector3(Math.cos(a) * 0.28, 0.01, Math.sin(a) * 0.28);
    const hub = new THREE.Vector3(0, 0.2, 0);
    const dir = foot.clone().sub(hub);
    const leg = mesh(new THREE.CylinderGeometry(0.008, 0.008, dir.length(), 8), steel, g);
    leg.position.copy(hub).addScaledVector(dir, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  return g;
}

function cymbal(parent, x, y, z, r, tilt) {
  const stand = mesh(new THREE.CylinderGeometry(0.01, 0.012, y, 8), steel, parent);
  stand.position.set(x, y / 2, z);
  const c = mesh(new THREE.CylinderGeometry(0.012, r, 0.02, 40), brass, parent);
  c.position.set(x, y, z);
  c.rotation.x = tilt;
  return c;
}

function drum(parent, r, h, mat, x, y, z, tiltX = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = tiltX;
  parent.add(g);
  mesh(new THREE.CylinderGeometry(r, r, h, 40), mat, g);
  const top = mesh(new THREE.CircleGeometry(r * 0.98, 40), drumHead, g);
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2 + 0.002;
  [h / 2, -h / 2].forEach((yy) => {
    const hoop = mesh(new THREE.TorusGeometry(r, 0.008, 8, 40), chrome, g);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = yy;
  });
  return g;
}

function stick(hand) {
  const s = new THREE.Group();
  hand.add(s);
  const wood = mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.4, 8), new THREE.MeshStandardMaterial({ color: "#d8b07a", roughness: 0.5 }), s);
  wood.position.y = -0.14;
  s.rotation.x = -1.2;
  return s;
}

// A relaxed standing stance: soft knees, weight rocking between the feet.
function stance(r, beat, e, width = 0.1) {
  const sway = Math.sin(beat * Math.PI) * e;
  r.hips.rotation.z = sway * 0.035;
  r.hips.position.x = sway * 0.022;
  r.legL.hip.rotation.set(-0.12 - Math.max(0, sway) * 0.1, 0, width);
  r.legR.hip.rotation.set(-0.07 - Math.max(0, -sway) * 0.1, 0, -width);
  r.legL.knee.rotation.x = 0.2 + Math.max(0, sway) * 0.18;
  r.legR.knee.rotation.x = 0.13 + Math.max(0, -sway) * 0.18;
  r.hips.position.y = 0.94 - Math.abs(sway) * 0.012;
  r.legL.hip.rotation.y = 0.18;
  r.legR.hip.rotation.y = -0.22;
}

// What makes a still figure look alive: breathing, a slow look around, a
// twist of the upper body, each on the player's own clock.
function life(r, t, seed) {
  const s = seed * 1.7;
  r.spine.rotation.y = 0.07 * Math.sin(t * 0.21 + s) + 0.03 * Math.sin(t * 0.53 + s * 2);
  r.spine.rotation.x += 0.012 * Math.sin(t * 1.5 + s);
  r.neck.rotation.y += 0.16 * Math.sin(t * 0.19 + s * 3) + 0.05 * Math.sin(t * 0.71 + s);
  r.neck.rotation.z = 0.05 * Math.sin(t * 0.37 + s * 5);
}

const _t = new THREE.Vector3();

// Each musician: { group, rig, anchor, play(t, beat, energy) }.
export function singer(w = wardrobe({ shirtMap: tee("#e8e2d8", "#1a1614"), skin: "#d29b78", pants: "#121114", jacket: "#141112", jacketRough: 0.32, hair: "#2a1a10" })) {
  const r = person(w, { hair: "long", build: 0.95, seed: 2 });
  const group = new THREE.Group();
  group.add(r.root);
  const stand = micStand(group, 1.45);
  stand.position.z = 0.42;
  const boom = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 10), steel, group);
  boom.position.set(0, 1.53, 0.36);
  boom.rotation.x = 0.9;
  const micBody = mesh(new THREE.CylinderGeometry(0.02, 0.014, 0.16, 16), steel, group);
  micBody.position.set(0, 1.62, 0.28);
  micBody.rotation.x = 1.2;
  const mic = mesh(new THREE.SphereGeometry(0.03, 16, 12), chrome, group);
  mic.position.set(0, 1.66, 0.21);
  r.armR.curl(0.85);
  r.armL.curl(0.3);
  return {
    group, rig: r, anchor: new THREE.Vector3(0, 2.05, 0),
    play(t, beat, e) {
      const b = Math.sin(beat * TAU);
      stance(r, beat, e, 0.07);
      r.spine.rotation.x = 0.1 + b * 0.025 * e;
      r.spine.rotation.z = Math.sin(beat * Math.PI) * 0.04 * e;
      r.neck.rotation.x = 0.12 + Math.sin(beat * TAU + 0.6) * 0.07 * e;
      r.neck.rotation.y = Math.sin(t * 0.4) * 0.15;
      // right hand around the mic, left arm free: down, then up on the chorus
      reach(r.armR, group.localToWorld(_t.set(-0.01, 1.58, 0.29)), poleFor(r, r.armR, 0.4, -0.35, -0.1));
      const lift = Math.max(0, Math.sin(t * 0.45)) * e;
      r.armL.shoulder.rotation.set(-0.25 - lift * 2.1, 0, 0.18 + lift * 0.45);
      r.armL.elbow.rotation.set(-0.3 - Math.abs(b) * 0.15 - lift * 0.3, 0, 0);
      r.armL.curl(0.3 + lift * 0.5);
      life(r, t, 2);
      r.neck.rotation.y *= 0.4; // stays on the mic
    }
  };
}

export function guitarist({ bass = false, finish = "#8a1c0b", w = wardrobe({ shirt: "#4b4b4f", skin: "#8a5a3c", pantsMap: denim("#2d3d5c") }), mats = null, hair = bass ? "short" : "long", seed = bass ? 5 : 4 } = {}) {
  const r = person(w, { hair, build: bass ? 1.05 : 1, seed, beard: bass });
  const group = new THREE.Group();
  group.add(r.root);
  const inst = electric({ bass, finish, mats });
  inst.position.set(-0.03, 0.0, 0.2);
  inst.rotation.set(0.12, 0.1, -1.15);
  r.hips.add(inst);
  const strap = mesh(new THREE.TorusGeometry(0.27, 0.012, 6, 30, Math.PI), w.hair, r.spine);
  strap.position.set(0, 0.26, 0.03);
  strap.rotation.set(0, 0, -0.95);
  const s = bass ? 1.05 : 0.9;
  const neckLen = bass ? 0.78 : 0.56;
  const speed = bass ? 1 : 2;
  r.armL.curl(0.7);
  r.armR.curl(0.8);
  let fret = 0.62;
  return {
    group, rig: r, instrument: inst, anchor: new THREE.Vector3(0, 2.05, 0),
    play(t, beat, e) {
      const b = Math.sin(beat * TAU);
      stance(r, beat, e, 0.13);
      r.spine.rotation.x = 0.1 + Math.abs(b) * 0.045 * e;
      r.spine.rotation.z = Math.sin(beat * Math.PI) * (bass ? 0.025 : 0.05) * e;
      r.neck.rotation.x = 0.35 + Math.abs(Math.sin(beat * Math.PI)) * 0.14 * e;
      r.neck.rotation.y = -0.35;
      inst.rotation.z = -1.15 + Math.sin(beat * Math.PI) * 0.025 * e;
      // chord changes every bar: the fretting hand slides along the neck
      const bar = Math.floor(beat / 4);
      const target = 0.5 + 0.25 * ((bar * 7) % 4) / 3;
      fret += (target - fret) * 0.12;
      life(r, t, seed);
      inst.updateWorldMatrix(true, false);
      reach(r.armL, inst.localToWorld(_t.set(0, 0.1 * s + neckLen * fret, -0.03)), poleFor(r, r.armL, 0.45, -0.4, -0.2));
      const strum = Math.sin(beat * TAU * speed) * e;
      reach(r.armR, inst.localToWorld(_t.set(strum * 0.05, -0.01 + strum * 0.02, 0.07)), poleFor(r, r.armR, 0.45, -0.1, -0.3));
    }
  };
}

export function drummer(w = wardrobe({ shirt: "#1b1b1d", skin: "#a8704c", pantsMap: denim("#27344d"), hair: "#0d0a08", jacket: null })) {
  const r = person(w, { hair: "cap", build: 1.08, seed: 6 });
  const group = new THREE.Group();
  group.add(r.root);
  r.hips.position.y = 0.58;
  r.legL.hip.rotation.set(-1.45, 0, 0.2);
  r.legR.hip.rotation.set(-1.45, 0, -0.2);
  r.legL.knee.rotation.x = 1.5;
  r.legR.knee.rotation.x = 1.5;
  const stool = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24), rubber, group);
  stool.position.set(0, 0.5, -0.02);
  const post = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 8), steel, group);
  post.position.set(0, 0.24, -0.02);
  const shell = figure(new THREE.MeshPhysicalMaterial({ color: "#3a0906", roughness: 0.22, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const kit = new THREE.Group();
  group.add(kit);
  const kick = drum(kit, 0.29, 0.42, shell, 0, 0.3, 0.75, Math.PI / 2);
  const snare = drum(kit, 0.18, 0.13, shell, -0.2, 0.66, 0.42, 0.2);
  drum(kit, 0.13, 0.16, shell, -0.14, 0.86, 0.72, 0.45);
  drum(kit, 0.14, 0.17, shell, 0.16, 0.86, 0.72, 0.45);
  drum(kit, 0.2, 0.36, shell, 0.5, 0.42, 0.38, 0.05);
  const hat = cymbal(kit, -0.52, 0.92, 0.42, 0.17, 0.05);
  const crash = cymbal(kit, -0.55, 1.34, 0.8, 0.24, 0.35);
  const ride = cymbal(kit, 0.62, 1.2, 0.72, 0.28, 0.3);
  r.armL.curl(1);
  r.armR.curl(1);
  const sticks = [stick(r.armL.hand), stick(r.armR.hand)];
  return {
    group, rig: r, anchor: new THREE.Vector3(0, 1.75, 0),
    play(t, beat, e) {
      const hitL = Math.exp(-((beat * 2) % 1) * 7);
      const hitR = Math.exp(-((beat * 2 + 0.5) % 1) * 7);
      r.spine.rotation.x = 0.2 + hitL * 0.03 * e;
      r.neck.rotation.x = 0.2 + Math.sin(beat * TAU) * 0.1 * e;
      r.neck.rotation.y = 0;
      life(r, t, 6);
      // left hand on the snare, right hand on the hi-hat, lifting between hits
      reach(r.armL, group.localToWorld(_t.set(-0.08, 0.8 + (1 - hitL) * 0.14 * e, 0.3)), poleFor(r, r.armL, 0.5, -0.3, -0.1));
      reach(r.armR, group.localToWorld(_t.set(-0.34, 0.9 + (1 - hitR) * 0.16 * e, 0.32)), poleFor(r, r.armR, 0.5, -0.3, -0.1));
      sticks[0].rotation.x = -1.35 + hitL * 0.35 * e;
      sticks[1].rotation.x = -1.35 + hitR * 0.35 * e;
      const crashHit = Math.exp(-(beat % 4) * 2.5);
      crash.rotation.z = crashHit * 0.12 * e;
      ride.rotation.z = Math.sin(t * 9) * 0.02 * e;
      hat.position.y = 0.92 + (1 - hitR) * 0.01;
      kick.position.z = 0.75 + Math.exp(-(beat % 1) * 10) * 0.006 * e;
      snare.rotation.z = hitL * 0.01;
    }
  };
}

export function keyboardist(w = wardrobe({ shirt: "#d8d4cc", skin: "#e2b28e", pants: "#1a1a22", jacket: "#1f2436", hair: "#5a3e22" })) {
  const r = person(w, { hair: "short", seed: 8 });
  const group = new THREE.Group();
  group.add(r.root);
  const deck = mesh(new RoundedBoxGeometry(1.0, 0.07, 0.32, 2, 0.015), new THREE.MeshPhysicalMaterial({ color: "#121013", roughness: 0.3, metalness: 0.3, clearcoat: 1 }), group);
  deck.position.set(0, 0.95, 0.46);
  const keys = mesh(new THREE.BoxGeometry(0.9, 0.012, 0.13), new THREE.MeshStandardMaterial({ color: "#8f8a80", roughness: 0.3 }), group);
  keys.position.set(0, 0.99, 0.54);
  [-1, 1].forEach((sx) => {
    const bar = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 8), steel, group);
    bar.position.set(0, 0.46, 0.46);
    bar.rotation.z = sx * 0.62;
  });
  r.armL.curl(0.35);
  r.armR.curl(0.35);
  return {
    group, rig: r, anchor: new THREE.Vector3(0, 2.05, 0),
    play(t, beat, e) {
      const b = Math.sin(beat * TAU);
      stance(r, beat, e * 0.6, 0.09);
      r.spine.rotation.x = 0.26 + Math.abs(b) * 0.035 * e;
      r.neck.rotation.x = 0.4 + Math.sin(beat * TAU + 1) * 0.09 * e;
      r.neck.rotation.y = 0;
      life(r, t, 8);
      r.neck.rotation.y *= 0.5;
      const lx = 0.16 + Math.sin(t * 0.9) * 0.08 * e;
      const rx = -0.16 + Math.sin(t * 0.7 + 2) * 0.1 * e;
      reach(r.armL, group.localToWorld(_t.set(lx, 1.04 + Math.max(0, Math.sin(t * 6)) * 0.02 * e, 0.52)), poleFor(r, r.armL, 0.5, -0.4, -0.2));
      reach(r.armR, group.localToWorld(_t.set(rx, 1.04 + Math.max(0, Math.sin(t * 7 + 1)) * 0.02 * e, 0.52)), poleFor(r, r.armR, 0.5, -0.4, -0.2));
    }
  };
}

export function percussionist(w = wardrobe({ shirt: "#8a6a1e", skin: "#6b4228", pants: "#5d4e3c", hair: "#0a0706" })) {
  const r = person(w, { hair: "curly", seed: 9, beard: true });
  const group = new THREE.Group();
  group.add(r.root);
  // sitting on a cajon, slapping its front
  const box = mesh(new RoundedBoxGeometry(0.32, 0.48, 0.32, 2, 0.015), new THREE.MeshStandardMaterial({ color: "#5a341c", roughness: 0.6 }), group);
  box.position.set(0, 0.24, 0);
  r.hips.position.set(0, 0.56, -0.02);
  r.legL.hip.rotation.set(-1.4, 0, 0.35);
  r.legR.hip.rotation.set(-1.4, 0, -0.35);
  r.legL.knee.rotation.x = 1.45;
  r.legR.knee.rotation.x = 1.45;
  r.armL.curl(0.1);
  r.armR.curl(0.1);
  return {
    group, rig: r, anchor: new THREE.Vector3(0, 1.65, 0),
    play(t, beat, e) {
      const hitL = Math.exp(-((beat * 2) % 1) * 8);
      const hitR = Math.exp(-((beat * 2 + 0.5) % 1) * 8);
      r.spine.rotation.x = 0.5 + (hitL + hitR) * 0.04 * e;
      r.neck.rotation.x = -0.15 + Math.sin(beat * TAU) * 0.1 * e;
      r.neck.rotation.y = 0;
      life(r, t, 9);
      reach(r.armL, group.localToWorld(_t.set(0.07, 0.44 + (1 - hitL) * 0.1 * e, 0.2)), poleFor(r, r.armL, 0.5, -0.2, 0.1));
      reach(r.armR, group.localToWorld(_t.set(-0.07, 0.44 + (1 - hitR) * 0.1 * e, 0.2)), poleFor(r, r.armR, 0.5, -0.2, 0.1));
    }
  };
}

// Gives a musician the interface the stage expects: state + tick().
export function asCast(m) {
  m.state = { appear: 1, energy: 0.6, muted: false, beat: 0, look: new THREE.Vector3() };
  let rest = 0;
  m.tick = (t, dt) => {
    rest += ((m.state.muted ? 1 : 0) - rest) * (1 - Math.exp(-dt * 4));
    m.play(t, m.state.beat, m.state.energy * (1 - rest * 0.85));
  };
  return m;
}

// You: a guitarist made of fire (uniforms: uTime, uReveal, uBase).
export function fireGuitarist(u) {
  const mat = fireMaterial(u);
  const you = guitarist({ w: { shirt: mat, skin: mat, pants: mat, hair: mat, strands: mat, face: mat }, mats: { body: mat, neck: mat, metal: mat, guard: mat } });
  you.group.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
  you.rig.hairLines.visible = false;
  you.rig.face.forEach((m) => { m.visible = false; });
  return you;
}

// You, the person the page is about: the same outfit in your bedroom and on
// the stage. With `burn`, you can rise out of the fire (burn.uBurn 1 -> 0).
export function yourWardrobe(burn = null) {
  return wardrobe({ shirtMap: tee("#241f24", "#f97316", "SG"), skin: "#d6a27c", pants: "#141418", jacketMap: denim("#41608e"), jacketRough: 0.85, hair: "#3a2616", iris: "#4a3018", burn });
}

export function youOnStage(burn) {
  const mats = {
    body: figure(new THREE.MeshPhysicalMaterial({ color: "#c2410c", roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), burn),
    neck: figure(new THREE.MeshStandardMaterial({ color: "#3a2214", roughness: 0.55 }), burn),
    metal: figure(new THREE.MeshStandardMaterial({ color: "#e6e6ea", metalness: 1, roughness: 0.18 }), burn),
    guard: figure(new THREE.MeshPhysicalMaterial({ color: "#0c0a09", roughness: 0.3, clearcoat: 1 }), burn)
  };
  return guitarist({ w: yourWardrobe(burn), mats, hair: "short", seed: 11 });
}

// You at the start: on the edge of the bed with an acoustic guitar resting on
// your right thigh. With help = 0 you try a chord, get it wrong, drop your
// head into your hand and try again (a 10-second loop). With help = 1 the app
// is open beside you and you play along, nodding to the beat.
// Where the hands go, in the guitar's space: x across the neck (+x toward the
// floor as it is held), y along the neck toward the headstock, z out of the
// top (the strings are at z = 0.12). The fretting wrist sits under the neck so
// the palm cups it and the fingers arch over onto the frets; the strumming
// wrist hangs over the strings between the soundhole and the bridge.
export const HANDS = {
  fret: [0.1, 0.135], chords: [0.53, 0.5, 0.55, 0.52], stuck: 0.52, fretFingers: [-1, -0.15, 0], fretPalm: [0, 0, -1], fretPole: [0.45, -0.4, -0.25], fretCurl: 0.95,
  strum: [-0.08, -0.03, 0.2], strumFingers: [0.75, 0, -0.65], strumPalm: [0, 0, -1], strumElbow: [-0.25, -0.2, 0.15], strumCurl: 0.85
};
export function strugglingPlayer() {
  const w = yourWardrobe();
  const r = person(w, { hair: "short", seed: 11 });
  const group = new THREE.Group();
  group.add(r.root);
  r.hips.position.y = 0.53;
  r.legL.hip.rotation.set(-1.45, 0.12, 0.2);
  r.legR.hip.rotation.set(-1.5, -0.05, -0.08);
  r.legL.knee.rotation.x = 1.5;
  r.legR.knee.rotation.x = 1.45;
  const g = createGuitar();
  const rig = new THREE.Group();
  // the waist of the guitar sits on top of the right thigh, the body in front
  // of the belly, the neck rising to the left
  rig.position.set(-0.02, 0.24, 0.2);
  rig.rotation.set(-0.12, 0.2, -1.2);
  rig.add(g.group);
  r.hips.add(rig);
  r.armL.curl(0.95);
  const win = (x, a, b2, c, d) => clamp((x - a) / (b2 - a)) * (1 - clamp((x - c) / (d - c)));
  const smooth = (v) => v * v * (3 - 2 * v);
  const fret = new THREE.Vector3();
  const strum = new THREE.Vector3();
  const brow = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const fingers = new THREE.Vector3();
  const palm = new THREE.Vector3();
  const rest = new THREE.Quaternion();
  let helped = 0;
  return {
    group, rig: r, guitar: g, anchor: new THREE.Vector3(0, 1.4, 0),
    play(t, help = 0, dt = 0.016) {
      helped += (help - helped) * (1 - Math.exp(-dt * 2.5));
      const c = t % 10;
      const quit = smooth(win(c, 4.8, 5.6, 8.2, 9.3)) * (1 - helped);
      const beat = t * 1.6;
      const nod = Math.abs(Math.sin(beat * Math.PI)) * helped;
      r.spine.rotation.x = lerp(0.3, 0.55, quit) + nod * 0.04 + Math.sin(t * 1.4) * 0.01;
      r.spine.rotation.y = 0.1 * (1 - quit) + 0.08 * helped;
      // head: down at the frets, dropped when giving up, toward the laptop when helped
      r.neck.rotation.x = lerp(lerp(0.55, 0.85, quit), 0.35 + nod * 0.12, helped);
      r.neck.rotation.y = lerp(lerp(0.45, 0.05, quit) + Math.sin(t * 0.7) * 0.04, 0.5 + Math.sin(t * 0.4) * 0.12, helped);
      r.neck.rotation.z = lerp(0, 0.08, quit);
      rig.updateWorldMatrix(true, false);
      // fretting hand: stuck between two shapes, or changing chords every bar
      // open chords live in the first three frets (the nut is at y = 0.6)
      const shape = helped > 0.5 ? HANDS.chords[Math.floor(beat / 4) % HANDS.chords.length] : HANDS.stuck + 0.02 * Math.sign(Math.sin(t * 0.9));
      g.group.localToWorld(fret.set(HANDS.fret[0], shape, HANDS.fret[1]));
      reach(r.armL, fret, poleFor(r, r.armL, HANDS.fretPole[0], HANDS.fretPole[1], HANDS.fretPole[2]));
      r.armL.curl(HANDS.fretCurl);
      orientHand(r.armL, fingers.fromArray(HANDS.fretFingers).transformDirection(g.group.matrixWorld), palm.fromArray(HANDS.fretPalm).transformDirection(g.group.matrixWorld));
      // strumming hand over the soundhole; the elbow rests on top of the
      // guitar's upper bout, so the forearm drapes over the body
      const amp = lerp(0.035, 0.06, helped) * (1 - quit);
      const speed = lerp(3.2, 10.05, helped);
      g.group.localToWorld(strum.set(HANDS.strum[0] + Math.sin(t * speed) * amp, HANDS.strum[1], HANDS.strum[2]));
      r.head.localToWorld(brow.set(0.02, 0.13, 0.13));
      strum.lerp(brow, quit);
      g.group.localToWorld(elbow.set(HANDS.strumElbow[0], HANDS.strumElbow[1], HANDS.strumElbow[2]));
      elbow.lerp(r.spine.localToWorld(_pole.set(-0.5, 0.8, 0.3)), quit);
      reach(r.armR, strum, elbow);
      // the strumming hand points down into the strings, fingers loosely
      // curled round the pick; it opens to rub the forehead when giving up
      r.armR.wrist.rotation.set(-0.2, 0, 0.3);
      rest.copy(r.armR.wrist.quaternion);
      orientHand(r.armR, fingers.fromArray(HANDS.strumFingers).transformDirection(g.group.matrixWorld), palm.fromArray(HANDS.strumPalm).transformDirection(g.group.matrixWorld));
      r.armR.wrist.quaternion.slerp(rest, quit);
      r.armR.curl(lerp(HANDS.strumCurl, 0.35, quit));
    }
  };
}
