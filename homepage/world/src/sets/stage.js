// World 4 and 5: the stage. The band plays under moving beams, the LED wall
// pulses, the crowd bobs, and the guitarist's spot is empty with YOU on it.
// For the encore the camera stands in that spot, facing a sea of phone lights
// and fireworks. The live demo on the page drives who is playing.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STEM_COLORS } from "../characters.js";
import { CLOTH, asCast, drummer, fireGuitarist, guitarist, keyboardist, percussionist, singer, wardrobe, tickHair } from "../band.js";
import { woodTexture, glowSprite, labelTexture, fabricTexture } from "../textures.js";
import { lerp, range, rng } from "../util.js";

const TOP = 0.6;
const SPOTS = {
  keys: [-2.3, -0.2],
  other: [-1.25, -1.0],
  vocals: [-0.25, 0.6],
  guitar: [0.95, 0.75],
  drums: [2.05, -1.2],
  bass: [3.05, 0.2]
};
const ORDER = ["keys", "other", "vocals", "guitar", "drums", "bass"];

function ledWall() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0.6 }, uLights: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime, uEnergy, uLights; varying vec2 vUv;
      float hash(float n){ return fract(sin(n)*43758.5453); }
      void main(){
        vec2 grid = vec2(150.0, 64.0);
        vec2 cell = floor(vUv*grid);
        vec2 f = fract(vUv*grid) - 0.5;
        float led = smoothstep(0.5, 0.25, length(f));
        // far away the dots are smaller than a pixel: blend them to their average, or they shimmer
        float px = fwidth(vUv.x * grid.x);
        led = mix(led, 0.45, clamp(px * 2.0 - 0.4, 0.0, 1.0));
        float col = floor(vUv.x*38.0);
        float h = 0.3 + 0.45*(0.5 + 0.5*sin(uTime*(0.25+hash(col)*0.35) + hash(col*3.1)*6.0))*uEnergy;
        float bar = step(vUv.y, h) * step(0.2, fract(vUv.x*38.0));
        vec3 fire = mix(vec3(1.0,0.25,0.05), vec3(1.0,0.8,0.2), vUv.y);
        float wave = 0.5+0.5*sin(vUv.x*6.0 - uTime*0.4 + sin(vUv.y*4.0+uTime*0.3));
        vec3 base = mix(vec3(0.25,0.03,0.12), vec3(0.45,0.12,0.02), wave) * 0.35;
        vec3 c = base + fire * bar * 1.6;
        gl_FragColor = vec4(c * led * uLights * 0.42, 1.0);
      }`
  });
}

function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 } },
    vertexShader: `
      varying float vAlong; varying float vFres;
      void main(){
        vAlong = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vec3 v = normalize(cameraPosition - wp.xyz);
        vFres = pow(abs(dot(n, v)), 1.6);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uIntensity; varying float vAlong; varying float vFres;
      void main(){
        float a = vFres * (0.25 + 0.75*vAlong) * smoothstep(0.0, 0.12, 1.0 - vAlong) * 0.2 * uIntensity;
        gl_FragColor = vec4(uColor * 1.4, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

// A standing fan, seen from the stage: torso with shoulders, neck and head.
export function crowdGeometry(armsUp) {
  const profile = [[0.001, 0], [0.15, 0], [0.16, 0.45], [0.2, 0.86], [0.23, 1.0], [0.2, 1.08], [0.08, 1.14], [0.055, 1.18], [0.001, 1.2]];
  const torso = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18);
  torso.scale(1, 1, 0.55);
  const head = new THREE.SphereGeometry(0.1, 16, 12);
  head.scale(1, 1.2, 1.05);
  head.translate(0, 1.32, 0);
  const parts = [torso, head];
  [-1, 1].forEach((s) => {
    const arm = new THREE.CapsuleGeometry(0.042, armsUp ? 0.62 : 0.5, 4, 8);
    if (armsUp) {
      arm.translate(0, 0.35, 0);
      arm.rotateZ(s * -0.3);
      arm.translate(s * 0.2, 1.04, 0);
    } else {
      arm.translate(0, -0.3, 0);
      arm.rotateZ(s * 0.08);
      arm.translate(s * 0.22, 1.0, 0);
    }
    parts.push(arm);
  });
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// Pool of firework and fountain sparks, simulated on the CPU.
function sparks(n) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const vel = new Float32Array(n * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("life", new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: glowSprite() }, uScale: { value: 1 } },
    vertexShader: `attribute vec3 color; attribute float life; uniform float uScale; varying vec3 vCol; varying float vLife;
      void main(){ vCol = color; vLife = life; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = uScale * (60.0 + 90.0*life) / -mv.z * step(0.001, life); }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vLife;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol*(1.5+2.5*vLife), a*vLife); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  let cursor = 0;
  const palette = Object.values(STEM_COLORS).map((c) => new THREE.Color(c));
  return {
    points,
    mat,
    burst(x, y, z, count, speed, rand) {
      const c = palette[Math.floor(rand() * palette.length)];
      for (let i = 0; i < count; i++) {
        const k = cursor;
        cursor = (cursor + 1) % n;
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const sp = speed * (0.75 + rand() * 0.3);
        pos.set([x, y, z], k * 3);
        vel.set([r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp], k * 3);
        col.set([c.r, c.g, c.b], k * 3);
        life[k] = 1;
      }
    },
    fountain(x, y, z, count, rand) {
      for (let i = 0; i < count; i++) {
        const k = cursor;
        cursor = (cursor + 1) % n;
        pos.set([x + (rand() - 0.5) * 0.1, y, z], k * 3);
        vel.set([(rand() - 0.5) * 1.2, 4.5 + rand() * 2.5, (rand() - 0.5) * 1.2], k * 3);
        col.set([1, 0.72 + rand() * 0.2, 0.35], k * 3);
        life[k] = 0.8;
      }
    },
    update(dt) {
      for (let k = 0; k < n; k++) {
        if (life[k] <= 0) continue;
        const i = k * 3;
        vel[i + 1] -= 3.2 * dt;
        vel[i] *= 1 - dt * 0.9;
        vel[i + 1] *= 1 - dt * 0.6;
        vel[i + 2] *= 1 - dt * 0.9;
        pos[i] += vel[i] * dt;
        pos[i + 1] += vel[i + 1] * dt;
        pos[i + 2] += vel[i + 2] * dt;
        life[k] = Math.max(0, life[k] - dt * 0.55);
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.life.needsUpdate = true;
    }
  };
}

export function createStage() {
  const group = new THREE.Group();
  const rand = rng(77);

  // Stage, riser, floor in front.
  const planks = woodTexture({ base: "#2a1a12", dark: "#0a0503", light: "#4a2e1f", seed: 51, planks: 10, repeat: [4, 2] });
  const deckMat = new THREE.MeshPhysicalMaterial({ map: planks, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10.5, TOP, 4.4), [
    new THREE.MeshStandardMaterial({ color: "#0d0a0c", roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: "#0d0a0c", roughness: 0.8 }),
    deckMat,
    deckMat,
    new THREE.MeshStandardMaterial({ color: "#111014", roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: "#111014", roughness: 0.7 })
  ]);
  deck.position.set(0, TOP / 2, -0.35);
  deck.receiveShadow = true;
  group.add(deck);
  const riser = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.35, 1.4, 2, 0.03), deckMat);
  riser.position.set(SPOTS.drums[0], TOP + 0.175, SPOTS.drums[1]);
  riser.castShadow = riser.receiveShadow = true;
  group.add(riser);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: new THREE.Color("#fb923c").multiplyScalar(3) }));
  edge.position.set(0, TOP - 0.03, 1.86);
  group.add(edge);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: "#07060a", roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = 8;
  ground.receiveShadow = true;
  group.add(ground);

  // LED wall and side curtains.
  const led = ledWall();
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(11, 5), led);
  wall.position.set(0, TOP + 2.6, -2.45);
  group.add(wall);
  const curtainMat = new THREE.MeshPhysicalMaterial({ map: fabricTexture("#3b0a0a", null, 3), roughness: 0.85, sheen: 1, sheenColor: "#b91c1c" });
  [-6.3, 6.3].forEach((x) => {
    const geo = new THREE.PlaneGeometry(2.4, 7, 40, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.12);
    geo.computeVertexNormals();
    const c = new THREE.Mesh(geo, curtainMat);
    c.position.set(x, 3.4, -1.6);
    c.rotation.y = x < 0 ? 0.5 : -0.5;
    group.add(c);
  });

  // Truss with fixtures and volumetric beams, one per spot.
  const trussMat = new THREE.MeshStandardMaterial({ color: "#6b6f78", metalness: 0.9, roughness: 0.35 });
  const trussY = 5.3;
  [-0.9, 1.3].forEach((z) => {
    [-0.14, 0.14].forEach((dy) => {
      [-0.14, 0.14].forEach((dz) => {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 11, 8), trussMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, trussY + dy, z + dz);
        group.add(bar);
      });
    });
  });
  const lensGlow = glowSprite();
  const beams = {};
  ORDER.forEach((k, i) => {
    const [sx, sz] = SPOTS[k];
    const fz = sz < 0 ? -0.9 : 1.3;
    const from = new THREE.Vector3(sx * 0.9, trussY - 0.25, fz);
    const floorY = TOP + (k === "drums" ? 0.35 : 0);
    const to = new THREE.Vector3(sx, floorY, sz);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const color = k === "guitar" ? "#fde68a" : new THREE.Color(STEM_COLORS[k]).lerp(new THREE.Color("#fff3e0"), 0.45).getStyle();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.34, 20), new THREE.MeshStandardMaterial({ color: "#16151a", metalness: 0.6, roughness: 0.4 }));
    can.position.copy(from);
    can.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    group.add(can);
    const lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: lensGlow, color: new THREE.Color(color).multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    lens.position.copy(from).addScaledVector(dir.clone().normalize(), 0.2);
    lens.scale.setScalar(0.7);
    group.add(lens);
    const geo = new THREE.ConeGeometry(0.75, len, 40, 1, true);
    geo.translate(0, -len / 2, 0);
    const beam = new THREE.Mesh(geo, beamMaterial(color));
    beam.position.copy(from);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    group.add(beam);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.95, 40), new THREE.MeshBasicMaterial({ map: lensGlow, color: new THREE.Color(color).multiplyScalar(0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(sx, floorY + 0.004, sz);
    group.add(pool);
    beams[k] = { beam, lens, pool, base: 1, sway: rand() * 6, from, to };
  });

  // Real lights: warm key with shadows, coloured backlight from the wall.
  const key = new THREE.SpotLight("#ffe8cc", 110, 22, 0.45, 0.6, 1.4);
  key.position.set(0.6, 6.5, 6);
  key.target.position.set(0.3, TOP, -0.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  group.add(key, key.target);
  const you = new THREE.SpotLight("#ffd27a", 70, 12, 0.32, 0.5, 1.3);
  you.position.set(SPOTS.guitar[0], trussY, 1.3);
  you.target.position.set(SPOTS.guitar[0], TOP, SPOTS.guitar[1]);
  group.add(you, you.target);
  const backL = new THREE.PointLight("#f97316", 30, 9, 1.4);
  backL.position.set(-2.5, 2.6, -1.9);
  const backR = new THREE.PointLight("#ec4899", 26, 9, 1.4);
  backR.position.set(2.8, 2.6, -1.9);
  group.add(backL, backR);
  const hemi = new THREE.HemisphereLight("#5a2a1a", "#0a0608", 0.12);
  group.add(hemi);

  // The band.
  const band = {
    keys: asCast(keyboardist()),
    other: asCast(percussionist()),
    vocals: asCast(singer()),
    drums: asCast(drummer()),
    bass: asCast(guitarist({ bass: true, finish: "#1a1210", w: wardrobe({ shirt: "#3a3a3e", skin: "#7e5236", pantsMap: CLOTH.denim("#232c40"), hair: "#0c0907" }) }))
  };
  const cast = {};
  Object.entries(band).forEach(([k, c]) => {
    const [x, z] = SPOTS[k];
    c.group.position.set(x, TOP + (k === "drums" ? 0.35 : 0), z);
    c.group.rotation.y = -x * 0.06;
    c.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(c.group);
    cast[k] = c;
  });
  // You, made of fire, step into the guitarist's spot when you take it.
  const fireU = { uTime: { value: 0 }, uReveal: { value: 0 }, uBase: { value: TOP } };
  const youFig = fireGuitarist(fireU);
  youFig.group.position.set(SPOTS.guitar[0], TOP, SPOTS.guitar[1]);
  youFig.group.rotation.y = -0.2;
  group.add(youFig.group);
  let youReveal = 0;

  // Your spot: an amp, a dashed ring and YOU.
  const spot = new THREE.Group();
  spot.position.set(SPOTS.guitar[0], TOP, SPOTS.guitar[1]);
  group.add(spot);
  const amp = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.55, 0.36, 3, 0.03), new THREE.MeshStandardMaterial({ map: fabricTexture("#1b1614", null, 21), roughness: 0.85 }));
  amp.position.set(0.75, 0.275, -0.4);
  amp.castShadow = true;
  spot.add(amp);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#fde047").multiplyScalar(2.5), transparent: true });
  const ring = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.012, 0.035), ringMat, 26);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m4.compose(new THREE.Vector3(Math.cos(a) * 0.62, 0.012, Math.sin(a) * 0.62), q, new THREE.Vector3(1, 1, 1));
    ring.setMatrixAt(i, m4);
  }
  spot.add(ring);
  const youSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture("YOU"), transparent: true, depthWrite: false }));
  youSign.scale.set(1.25, 0.47, 1);
  youSign.position.set(0, 2.35, 0);
  spot.add(youSign);

  // Crowd: two instanced meshes (arms down / arms up) plus phone lights.
  // unlit: the fans read as silhouettes against the stage light
  const crowdMat = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
  const fans = [];
  const downGeo = crowdGeometry(false);
  const upGeo = crowdGeometry(true);
  const downMesh = new THREE.InstancedMesh(downGeo, crowdMat, 200);
  const upMesh = new THREE.InstancedMesh(upGeo, crowdMat, 110);
  const phones = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color("#dbeafe").multiplyScalar(3), side: THREE.DoubleSide }), 110);
  const tint = new THREE.Color();
  let di = 0;
  let ui = 0;
  for (let row = 0; row < 12; row++) {
    const z = 2.9 + row * 0.62 + rand() * 0.2;
    const n = 22 + row * 2;
    for (let i = 0; i < n; i++) {
      const x = -6.5 + (i / (n - 1)) * 13 + (rand() - 0.5) * 0.4;
      const up = rand() < 0.33 && ui < 110;
      if (!up && di >= 200) continue;
      const h = 0.88 + rand() * 0.22;
      tint.setHSL(0.04 + rand() * 0.04, 0.5, 0.012 + rand() * 0.018);
      const mesh = up ? upMesh : downMesh;
      const idx = up ? ui++ : di++;
      mesh.setColorAt(idx, tint);
      fans.push({ mesh, idx, x, z, h, phase: rand(), up, rot: (rand() - 0.5) * 0.5 });
    }
  }
  downMesh.count = di;
  upMesh.count = ui;
  [downMesh, upMesh].forEach((m) => { m.instanceColor.needsUpdate = true; group.add(m); });
  phones.count = 0;
  group.add(phones);

  // Encore effects.
  const fx = sparks(3200);
  group.add(fx.points);
  const confettiColors = Object.values(STEM_COLORS).map((c) => new THREE.Color(c));
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.08), new THREE.MeshStandardMaterial({ color: "#fff", side: THREE.DoubleSide, roughness: 0.5, emissive: "#222" }), 420);
  const bits = Array.from({ length: 420 }, (_, i) => {
    confetti.setColorAt(i, confettiColors[i % confettiColors.length]);
    return { x: -6 + rand() * 12, y: rand() * 8, z: 1 + rand() * 9, s: rand() * 10, v: 0.5 + rand() * 0.8 };
  });
  confetti.instanceColor.needsUpdate = true;
  confetti.count = 0;
  group.add(confetti);

  const dummy = new THREE.Object3D();
  let nextBurst = 0;
  const look = new THREE.Vector3();

  return {
    name: "stage",
    group,
    background: new THREE.Color("#07050a"),
    fog: new THREE.Fog("#07050a", 9, 34),
    environment: 0.22,
    bloom: 0.42,
    cast,
    spotAnchor: new THREE.Vector3(SPOTS.guitar[0], TOP + 1.9, SPOTS.guitar[1]),
    update(t, dt, info) {
      tickHair(t);
      const encore = info.params.encore || 0;
      const lights = info.enter == null ? 1 : range(info.enter, 0.15, 0.95);
      const demo = info.demo;
      const playing = demo.playing ? 1 : 0;
      const youOn = demo.muted.guitar ? 1 : 0;
      const energy = lerp(0.55, 1, Math.max(playing, encore));
      const beat = t * (87 / 60);

      led.uniforms.uTime.value = t;
      led.uniforms.uEnergy.value = energy;
      led.uniforms.uLights.value = lights;
      key.intensity = 26 * lights;
      backL.intensity = 30 * lights * (0.95 + 0.05 * Math.sin(t * 0.4));
      backR.intensity = 26 * lights * (0.95 + 0.05 * Math.cos(t * 0.35));
      you.intensity = lerp(55, 120, youOn) * lights;

      // Beams switch on one by one as the lights come up, then sway.
      ORDER.forEach((k, i) => {
        const b = beams[k];
        const on = range(lights, i / 7, i / 7 + 0.15);
        const muted = demo.muted[k === "keys" ? "piano" : k] ? 0.25 : 1;
        const gold = k === "guitar" ? lerp(0.8, 1.6, youOn) : 1;
        b.beam.material.uniforms.uIntensity.value = on * muted * gold * (0.96 + 0.04 * Math.sin(t * 0.3 + b.sway));
        b.lens.material.opacity = on;
        b.pool.material.opacity = on * muted * gold * 0.55;
      });

      // The band.
      look.copy(info.camera.position);
      Object.entries(cast).forEach(([k, c]) => {
        c.state.appear = 1;
        c.state.beat = beat;
        c.state.energy = energy;
        c.state.muted = !!demo.muted[k === "keys" ? "piano" : k];
        c.state.look.copy(look);
        c.tick(t, dt);
      });
      youReveal += ((youOn && encore < 0.05 ? 1 : 0) - youReveal) * (1 - Math.exp(-dt * 1.6));
      fireU.uTime.value = t;
      fireU.uReveal.value = youReveal;
      youFig.group.visible = youReveal > 0.01;
      youFig.play(t, beat, energy);

      // Your spot glows brighter when you have taken the guitarist's place.
      ringMat.color.setRGB(1, 0.88, 0.3).multiplyScalar(lerp(1.6, 4, youOn) * (0.9 + 0.1 * Math.sin(t * 0.8)) * lights);
      ring.rotation.y = t * 0.25;
      youSign.position.y = 2.35 + Math.sin(t * 2.2) * 0.05;
      youSign.material.opacity = lights * (1 - range(encore, 0.3, 0.7));

      // Crowd bobs on the beat; more of them jump and hold up phones for the encore.
      const jump = lerp(0.05, 0.16, Math.max(encore, playing * 0.6 + youOn * 0.4));
      let p = 0;
      const phoneShare = lerp(0.15, 1, encore);
      for (const f of fans) {
        const b = Math.abs(Math.sin((beat + f.phase) * Math.PI));
        dummy.position.set(f.x, b * jump, f.z);
        dummy.rotation.set(0, f.rot, Math.sin((beat + f.phase) * Math.PI) * 0.05);
        dummy.scale.set(1, f.h * (1 - b * 0.03), 1);
        dummy.updateMatrix();
        f.mesh.setMatrixAt(f.idx, dummy.matrix);
        if (f.up && f.phase < phoneShare && p < 110) {
          dummy.position.set(f.x + 0.26, 1.62 * f.h + b * jump + 0.18, f.z - 0.02);
          dummy.rotation.set(0, f.rot + Math.PI, 0.1);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          phones.setMatrixAt(p++, dummy.matrix);
        }
      }
      phones.count = p;
      phones.instanceMatrix.needsUpdate = true;
      for (const m of [downMesh, upMesh]) m.instanceMatrix.needsUpdate = true;

      // Encore: fireworks over the crowd, fountains on the stage edge, confetti.
      if (encore > 0.3) {
        nextBurst -= dt;
        if (nextBurst <= 0) {
          fx.burst(-6 + rand() * 12, 5 + rand() * 3.5, 8 + rand() * 8, 220, 3.4 + rand() * 1.6, rand);
          nextBurst = lerp(1.2, 0.35, encore) * (0.6 + rand() * 0.8);
        }
        fx.fountain(-4.6, TOP, 1.7, 3, rand);
        fx.fountain(4.6, TOP, 1.7, 3, rand);
      }
      fx.mat.uniforms.uScale.value = info.pointScale;
      fx.update(dt);
      confetti.count = Math.round(420 * range(encore, 0.2, 0.9));
      for (let i = 0; i < confetti.count; i++) {
        const c = bits[i];
        c.y -= dt * c.v;
        if (c.y < 0) c.y += 8;
        dummy.position.set(c.x + Math.sin(t + c.s) * 0.3, c.y, c.z);
        dummy.rotation.set(t * 2 + c.s, t * 3 + c.s, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
    }
  };
}

export { SPOTS, TOP };
