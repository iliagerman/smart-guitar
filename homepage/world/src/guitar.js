// A procedural acoustic guitar. Local space: body in the XY plane, strings on
// the +Z face, headstock toward +Y. About 1 m long.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { woodTexture, spruceTopTexture, rosetteTexture, tortoiseTexture } from "./textures.js";

export const BODY_DEPTH = 0.1;
const BEVEL = 0.008;
export const TOP_Z = BODY_DEPTH + BEVEL;
const NUT_Y = 0.6;
const SADDLE_Y = -0.113;
const SCALE = NUT_Y - SADDLE_Y;
export const SOUNDHOLE = new THREE.Vector3(0, 0.035, TOP_Z);
const HOLE_R = 0.052;

// Right half of a dreadnought-ish outline, mirrored for the left half.
export function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.25);
  s.bezierCurveTo(0.12, -0.25, 0.205, -0.19, 0.205, -0.09);
  s.bezierCurveTo(0.205, 0.0, 0.122, 0.01, 0.122, 0.065);
  s.bezierCurveTo(0.122, 0.1, 0.155, 0.12, 0.15, 0.17);
  s.bezierCurveTo(0.145, 0.232, 0.07, 0.25, 0, 0.25);
  s.bezierCurveTo(-0.07, 0.25, -0.145, 0.232, -0.15, 0.17);
  s.bezierCurveTo(-0.155, 0.12, -0.122, 0.1, -0.122, 0.065);
  s.bezierCurveTo(-0.122, 0.01, -0.205, 0.0, -0.205, -0.09);
  s.bezierCurveTo(-0.205, -0.19, -0.12, -0.25, 0, -0.25);
  return s;
}

function taper(geometry, axis, from, to, y0, y1) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - y0) / (y1 - y0);
    p.setComponent(i, axis, p.getComponent(i, axis) * (from + (to - from) * Math.min(1, Math.max(0, t))));
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
}

const boardWidth = (y) => 0.058 + (0.046 - 0.058) * ((y - 0.095) / (NUT_Y - 0.095));

export function createGuitar() {
  const group = new THREE.Group();
  group.name = "guitar";

  const rosewood = woodTexture({ base: "#3a1c10", dark: "#120703", light: "#6b3a22", seed: 12, vertical: false, repeat: [4, 4] });
  const fretWood = woodTexture({ base: "#1e110b", dark: "#050201", light: "#3b2217", seed: 13, vertical: true });

  const sideMat = new THREE.MeshPhysicalMaterial({ map: rosewood, color: "#b86a3c", roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12 });
  const ebony = new THREE.MeshPhysicalMaterial({ color: "#150b07", roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const bone = new THREE.MeshStandardMaterial({ color: "#f1e7d1", roughness: 0.35 });
  const nickel = new THREE.MeshStandardMaterial({ color: "#dcdcdc", metalness: 1, roughness: 0.22 });
  const bronze = new THREE.MeshStandardMaterial({ color: "#d1a36a", metalness: 1, roughness: 0.28 });
  const steel = new THREE.MeshStandardMaterial({ color: "#e8e8ea", metalness: 1, roughness: 0.2 });
  const pearl = new THREE.MeshPhysicalMaterial({ color: "#f4efe6", roughness: 0.2, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1 });
  const cream = new THREE.MeshStandardMaterial({ color: "#efe3c6", roughness: 0.3 });

  // Body with a real soundhole.
  const shape = bodyShape();
  const hole = new THREE.Path();
  hole.absarc(SOUNDHOLE.x, SOUNDHOLE.y, HOLE_R, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: BODY_DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 64 });
  bodyGeo.computeBoundingBox();
  const bb = bodyGeo.boundingBox;
  const topMat = new THREE.MeshPhysicalMaterial({
    map: spruceTopTexture({ minX: bb.min.x, minY: bb.min.y, w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y }),
    roughness: 0.36,
    clearcoat: 1,
    clearcoatRoughness: 0.05
  });
  const body = new THREE.Mesh(bodyGeo, [topMat, sideMat]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Dark inside of the body, seen through the soundhole.
  const inside = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R * 1.05, 48), new THREE.MeshBasicMaterial({ color: "#050302" }));
  inside.position.set(SOUNDHOLE.x, SOUNDHOLE.y, 0.004);
  group.add(inside);

  const rosette = new THREE.Mesh(new THREE.RingGeometry(HOLE_R, HOLE_R * 1.42, 64), new THREE.MeshPhysicalMaterial({ map: rosetteTexture(), roughness: 0.3, clearcoat: 1 }));
  rosette.position.set(SOUNDHOLE.x, SOUNDHOLE.y, TOP_Z + 0.0004);
  // RingGeometry UVs span the full square, so the rosette texture lines up with the ring.
  group.add(rosette);

  // Cream binding along the top edge.
  const outline = bodyShape().getSpacedPoints(220).map((p) => new THREE.Vector3(p.x * 1.035, p.y * 1.02, TOP_Z - 0.003));
  const binding = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 400, 0.0032, 6, true), cream);
  group.add(binding);

  // Pickguard (teardrop below the soundhole, treble side).
  const pg = new THREE.Shape();
  pg.moveTo(0.03, -0.02);
  pg.bezierCurveTo(0.1, -0.03, 0.13, 0.03, 0.105, 0.08);
  pg.bezierCurveTo(0.085, 0.115, 0.06, 0.1, 0.065, 0.07);
  pg.bezierCurveTo(0.07, 0.02, 0.055, -0.005, 0.03, -0.02);
  const pickguard = new THREE.Mesh(new THREE.ShapeGeometry(pg, 32), new THREE.MeshPhysicalMaterial({ map: tortoiseTexture(), roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.95 }));
  pickguard.material.map.repeat.set(6, 6);
  pickguard.material.map.wrapS = pickguard.material.map.wrapT = THREE.RepeatWrapping;
  pickguard.position.z = TOP_Z + 0.0006;
  group.add(pickguard);

  // Neck and fretboard.
  const neckGeo = new RoundedBoxGeometry(0.056, 0.39, 0.03, 3, 0.012);
  neckGeo.translate(0, 0.195, 0);
  taper(neckGeo, 0, 1.06, 0.84, 0, 0.39);
  const neck = new THREE.Mesh(neckGeo, sideMat);
  neck.position.set(0, 0.215, TOP_Z - 0.012);
  neck.castShadow = true;
  group.add(neck);

  const boardGeo = new THREE.BoxGeometry(0.058, NUT_Y - 0.095, 0.006);
  boardGeo.translate(0, (NUT_Y - 0.095) / 2, 0);
  taper(boardGeo, 0, 1, 0.046 / 0.058, 0, NUT_Y - 0.095);
  const board = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ map: fretWood, roughness: 0.72 }));
  board.position.set(0, 0.095, TOP_Z + 0.006);
  board.castShadow = true;
  group.add(board);
  const boardTop = TOP_Z + 0.009;

  const fretY = (n) => NUT_Y - SCALE * (1 - Math.pow(2, -n / 12));
  for (let n = 1; n <= 20; n++) {
    const y = fretY(n);
    if (y < 0.1) break;
    const fret = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, boardWidth(y), 6), nickel);
    fret.rotation.z = Math.PI / 2;
    fret.position.set(0, y, boardTop + 0.0006);
    group.add(fret);
  }
  const dot = new THREE.CylinderGeometry(0.0038, 0.0038, 0.001, 20);
  [3, 5, 7, 9, 12, 15, 17].forEach((n) => {
    const y = (fretY(n) + fretY(n - 1)) / 2;
    const xs = n === 12 ? [-0.012, 0.012] : [0];
    xs.forEach((x) => {
      const d = new THREE.Mesh(dot, pearl);
      d.rotation.x = Math.PI / 2;
      d.position.set(x, y, boardTop + 0.0002);
      group.add(d);
    });
  });

  const nut = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.005, 0.009), bone);
  nut.position.set(0, NUT_Y, boardTop + 0.003);
  group.add(nut);

  // Headstock, angled back from the nut.
  const head = new THREE.Group();
  head.position.set(0, NUT_Y, TOP_Z - 0.004);
  head.rotation.x = -0.22;
  const hs = new THREE.Shape();
  hs.moveTo(-0.026, 0);
  hs.lineTo(-0.042, 0.16);
  hs.quadraticCurveTo(-0.044, 0.195, -0.015, 0.2);
  hs.quadraticCurveTo(0, 0.188, 0.015, 0.2);
  hs.quadraticCurveTo(0.044, 0.195, 0.042, 0.16);
  hs.lineTo(0.026, 0);
  hs.lineTo(-0.026, 0);
  const headMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(hs, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 }), [ebony, sideMat]);
  headMesh.position.z = -0.004;
  headMesh.castShadow = true;
  head.add(headMesh);
  const post = new THREE.CylinderGeometry(0.0035, 0.0035, 0.014, 10);
  const knob = new THREE.SphereGeometry(0.011, 16, 12);
  [0.05, 0.095, 0.14].forEach((y) => {
    [-1, 1].forEach((side) => {
      const x = side * (0.02 + y * 0.06);
      const p = new THREE.Mesh(post, nickel);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, y, 0.019);
      head.add(p);
      const k = new THREE.Mesh(knob, pearl);
      k.scale.set(1.25, 0.9, 0.35);
      k.position.set(side * 0.063, y, 0.006);
      head.add(k);
    });
  });
  group.add(head);

  // Bridge, saddle, pins.
  const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.01, 2, 0.004), ebony);
  bridge.position.set(0, -0.121, TOP_Z + 0.004);
  bridge.castShadow = true;
  group.add(bridge);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.003, 0.006), bone);
  saddle.position.set(0, SADDLE_Y, TOP_Z + 0.011);
  group.add(saddle);
  const pinGeo = new THREE.SphereGeometry(0.0032, 12, 8);
  for (let i = 0; i < 6; i++) {
    const pin = new THREE.Mesh(pinGeo, bone);
    pin.position.set((i - 2.5) * 0.0105, -0.13, TOP_Z + 0.009);
    group.add(pin);
  }

  // Strings: thin cylinders we bend on the CPU when plucked.
  const strings = [];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const radii = [0.0013, 0.0011, 0.0009, 0.0007, 0.00055, 0.00045];
  for (let i = 0; i < 6; i++) {
    const a = new THREE.Vector3((i - 2.5) * 0.0105, SADDLE_Y, TOP_Z + 0.0135);
    const b = new THREE.Vector3((i - 2.5) * 0.0072, NUT_Y, boardTop + 0.0075);
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(radii[i], radii[i], len, 6, 64, true);
    const mesh = new THREE.Mesh(geo, i < 3 ? bronze : steel);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    group.add(mesh);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, len, 6), hitMat);
    hit.position.copy(mesh.position);
    hit.quaternion.copy(mesh.quaternion);
    hit.userData.string = i;
    group.add(hit);
    strings.push({ mesh, hit, len, base: geo.attributes.position.array.slice(), amp: 0, phase: Math.random() * 6, freq: 13 + i * 2.2, idle: 0.00012 });
  }

  function pluck(i, strength = 1) {
    strings[i].amp = Math.min(0.0045, strings[i].amp + 0.0032 * strength);
  }

  function update(dt) {
    for (const s of strings) {
      s.amp *= Math.exp(-dt * 2.4);
      const a = s.amp + s.idle;
      s.phase += dt * s.freq * Math.PI * 2;
      const pos = s.mesh.geometry.attributes.position;
      const arr = pos.array;
      const base = s.base;
      const sw = Math.sin(s.phase);
      for (let k = 0; k < arr.length; k += 3) {
        const u = base[k + 1] / s.len + 0.5;
        arr[k] = base[k] + a * Math.sin(Math.PI * u) * sw;
      }
      pos.needsUpdate = true;
    }
  }

  return { group, pluck, update, hits: strings.map((s) => s.hit) };
}
