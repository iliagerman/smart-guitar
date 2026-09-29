// World 2: the band behind the song, on a concert stage in front of a packed
// crowd; the camera starts high above and comes down. First they play as one, huddled under a
// single warm light (the recording, all mixed together). Then they step apart,
// each into their own coloured spotlight (the separated tracks). Then the
// guitarist burns away into embers, and in their place a figure of fire takes
// up the guitar and plays with the band: you.
import * as THREE from "three";
import { STEM_COLORS } from "../characters.js";
import { CLOTH, NOISE, drummer, figure, guitarist, keyboardist, singer, wardrobe, tickHair, youOnStage } from "../band.js";
import { glowSprite, labelTexture } from "../textures.js";
import { range, rng } from "../util.js";
import { concertHall } from "./concert.js";

// Where everyone stands once the band is pulled apart ([x, y, z]); before
// that they huddle toward the middle.
const SPOTS = {
  keys: [-1.5, 0, -0.8],
  bass: [0.0, 0, 0.3],
  vocals: [1.5, 0, 1.0],
  guitar: [2.9, 0, 0.35],
  drums: [1.3, 0.36, -1.9]
};
const HUDDLE = new THREE.Vector3(1.1, 0, -0.1);
export const YOU_SPOT = new THREE.Vector3(...SPOTS.guitar);

function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
    vertexShader: `varying float vAlong; varying float vFres;
      void main(){ vAlong = 1.0 - (position.y + 0.5); vec4 w = modelMatrix*vec4(position,1.0);
        vec3 n = normalize(mat3(modelMatrix)*normal); vec3 v = normalize(cameraPosition - w.xyz);
        vFres = abs(dot(n, v)); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying float vAlong; varying float vFres;
      void main(){ float a = vFres*vFres * (0.3 + 0.7*vAlong) * smoothstep(0.0, 0.1, 1.0 - vAlong) * 0.085 * uIntensity;
        gl_FragColor = vec4(uColor * 1.5, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

// A light from the rig above: a real spotlight plus a hazy cone of light.
function stageLight(group, color, at) {
  const top = new THREE.Vector3(at.x + 0.3, 7, at.z + 1.4);
  const spot = new THREE.SpotLight(color, 0, 16, 0.34, 0.65, 1.2);
  spot.position.copy(top);
  spot.target.position.set(at.x, at.y + 0.9, at.z);
  group.add(spot, spot.target);
  const len = top.distanceTo(new THREE.Vector3(at.x, 0, at.z));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.05, 1, 32, 1, true), beamMaterial(color));
  beam.scale.set(1, len, 1);
  beam.position.copy(top).lerp(new THREE.Vector3(at.x, 0, at.z), 0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(new THREE.Vector3(at.x, 0, at.z)).normalize());
  group.add(beam);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({ map: glowSprite(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(at.x, at.y + 0.005, at.z);
  group.add(pool);
  return {
    set(v, power = 34) {
      spot.intensity = v * power;
      beam.material.uniforms.uIntensity.value = v;
      pool.material.opacity = v * 0.12;
    },
    spot
  };
}

// Smoky backdrop glowing with fire from below.
function backdrop() {
  return new THREE.Mesh(new THREE.PlaneGeometry(46, 16), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 p = vUv * vec2(9.0, 3.2);
        float smoke = fbm3(vec3(p.x*0.6, p.y - uTime*0.08, uTime*0.05));
        float glow = smoothstep(0.75, 0.0, vUv.y) * (0.55 + 0.45*fbm3(vec3(p.x*1.5, p.y*2.0 - uTime*0.5, 3.0)));
        float mx = (vUv.x - 0.52) * 2.6;
        float mid = exp(-mx * mx); // pow() of a negative is NaN
        // near-black haze, warmed only by the backlight behind the band
        vec3 col = vec3(0.022, 0.017, 0.024) * (0.4 + smoke);
        col += fireRamp(glow * mid * 0.5) * 0.09 * smoke;
        gl_FragColor = vec4(col, 1.0);
      }`
  }));
}

// Embers rising through the whole stage; a burst of them where the guitarist burns.
function embers(rand, n = 600) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([-7 + rand() * 14, rand() * 6, -3.5 + rand() * 6], i * 3);
    seed[i] = rand() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glowSprite() }, uScale: { value: 1 }, uBurst: { value: 0 }, uAt: { value: YOU_SPOT.clone() } },
    vertexShader: `attribute float seed; uniform float uTime, uScale, uBurst; uniform vec3 uAt; varying float vA;
      void main(){
        vec3 p = position;
        float life = fract(seed*0.37 + uTime*(0.05 + 0.04*fract(seed*3.1)));
        p.y = life * 6.5;
        p.x += sin(uTime*0.6 + seed)*0.3 + sin(life*9.0 + seed)*0.2;
        // a share of them gather round the guitarist's spot while it burns
        float mine = step(0.7, fract(seed*5.3)) * uBurst;
        p = mix(p, uAt + vec3(sin(seed*4.0)*0.45, life*2.6, cos(seed*2.0)*0.3), mine);
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = uScale*(10.0 + 18.0*fract(seed*7.1))/-mv.z;
        vA = sin(life*3.14159) * (0.45 + 0.55*mine); }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vec3(1.0,0.55,0.18)*2.2, a*vA); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

export function createSong() {
  const group = new THREE.Group();
  const rand = rng(5);

  const hall = concertHall(group, rand, beamMaterial);
  const riser = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.36, 2.0), new THREE.MeshStandardMaterial({ color: "#140d0a", roughness: 0.6 }));
  riser.position.set(SPOTS.drums[0], 0.18, SPOTS.drums[2] + 0.2);
  riser.receiveShadow = true;
  group.add(riser);
  const back = backdrop();
  back.position.set(0.8, 7, -5.5);
  group.add(back);
  const fx = embers(rand);
  group.add(fx.pts);

  // Amps behind the guitarist and bassist.
  const ampMat = new THREE.MeshStandardMaterial({ color: "#100c0b", roughness: 0.85 });
  [[SPOTS.guitar[0] + 0.3, SPOTS.guitar[2] - 1.1], [SPOTS.bass[0] - 0.4, SPOTS.bass[2] - 1.2]].forEach(([x, z]) => {
    const amp = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.4), ampMat);
    amp.position.set(x, 0.3, z);
    group.add(amp);
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.42), new THREE.MeshStandardMaterial({ color: "#1c1512", roughness: 1 }));
    grille.position.set(x, 0.27, z + 0.201);
    group.add(grille);
  });

  // The band.
  const members = {
    keys: keyboardist(),
    bass: guitarist({ bass: true, finish: "#1a1210", w: wardrobe({ shirt: "#3a3a3e", skin: "#7e5236", pantsMap: CLOTH.denim("#232c40"), hair: "#0c0907" }) }),
    vocals: singer(),
    drums: drummer()
  };
  // the guitarist can burn away
  const burn = { uBurn: { value: 0 } };
  const gw = wardrobe({ shirtMap: CLOTH.tee("#161416", "#e8742a"), skin: "#c28a64", pantsMap: CLOTH.denim("#2d3d5c"), jacketMap: CLOTH.plaid("#7a1a12", "#1a0c0a", "#d9a441"), jacketRough: 0.9, hair: "#0c0907", burn });
  const guitarMats = {
    body: figure(new THREE.MeshPhysicalMaterial({ color: "#8a1c0b", roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), burn),
    neck: figure(new THREE.MeshStandardMaterial({ color: "#3a2214", roughness: 0.55 }), burn),
    metal: figure(new THREE.MeshStandardMaterial({ color: "#e6e6ea", metalness: 1, roughness: 0.18 }), burn),
    guard: figure(new THREE.MeshPhysicalMaterial({ color: "#0c0a09", roughness: 0.3, clearcoat: 1 }), burn)
  };
  members.guitar = guitarist({ w: gw, mats: guitarMats });

  // You: the same person from the bedroom, rising out of the fire.
  const youBurn = { uBurn: { value: 1 } };
  const you = youOnStage(youBurn);
  you.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  you.group.position.set(...SPOTS.guitar);
  you.group.rotation.y = -0.35;
  group.add(you.group);
  const youLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture("YOU"), transparent: true, depthWrite: false, opacity: 0 }));
  youLabel.scale.set(1.1, 0.41, 1);
  group.add(youLabel);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.66, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color("#fde047").multiplyScalar(2.5), transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SPOTS.guitar[0], 0.01, SPOTS.guitar[2]);
  group.add(ring);

  const cast = {};
  const facing = { keys: 0.35, bass: 0.15, vocals: -0.05, guitar: -0.35, drums: 0 };
  Object.entries(members).forEach(([k, m]) => {
    m.group.rotation.y = facing[k];
    m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(m.group);
    m.state = { appear: 0 };
    if (k !== "guitar") cast[k] = m;
  });

  // Lights: one warm wash over the huddle, one colour per musician, a gold
  // light for you, and hot rim lights from behind that cut out the figures.
  const wash = stageLight(group, "#ffc98a", new THREE.Vector3(HUDDLE.x, 0, HUDDLE.z + 0.3));
  const lights = {};
  Object.keys(SPOTS).forEach((k) => {
    // warm gold follow-spots, each tinted a little by its track colour
    lights[k] = stageLight(group, new THREE.Color(STEM_COLORS[k]).lerp(new THREE.Color("#ffd89a"), 0.6), new THREE.Vector3(...SPOTS[k]));
  });
  const youLight = stageLight(group, "#ffd27a", YOU_SPOT);
  [[-3.5, "#ff9a3c"], [1, "#ffc070"], [5, "#ff8a2a"]].forEach(([x, c]) => {
    // high and behind, aimed down at the players' backs
    const rim = new THREE.SpotLight(c, 40, 14, 0.55, 0.7, 1.3);
    rim.position.set(x, 5.5, -4.2);
    rim.target.position.set(x * 0.5 + 0.5, 1.0, 0.2);
    group.add(rim, rim.target);
  });
  group.add(new THREE.HemisphereLight("#ff9a5a", "#120806", 0.08));

  // The back truss: a row of lamps aimed over the band at the audience. Their
  // bulbs flare in the lens and their beams cut through the haze.
  const glow = glowSprite();
  const lamps = [];
  const trussMat = new THREE.MeshStandardMaterial({ color: "#121015", metalness: 0.7, roughness: 0.5 });
  const truss = new THREE.Mesh(new THREE.BoxGeometry(11, 0.22, 0.22), trussMat);
  truss.position.set(0.8, 5.75, -4.3);
  group.add(truss);
  for (let i = 0; i < 7; i++) {
    const x = -4 + i * 1.6;
    const at = new THREE.Vector3(x, 5.5, -4.2);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe2b0").multiplyScalar(6) }));
    bulb.position.copy(at).add(new THREE.Vector3(0, 0, 0.12));
    group.add(bulb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#ffb45e", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    halo.scale.set(1.3, 1.3, 1);
    halo.position.copy(bulb.position);
    group.add(halo);
    const streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#ffc98a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    streak.scale.set(4.2, 0.07, 1);
    streak.position.copy(bulb.position);
    group.add(streak);
    // a hazy beam from the lamp down over the band toward the front
    const to = new THREE.Vector3(x * 0.6 + 0.4 + (i % 2 ? 0.8 : -0.8), 0, 2.5);
    const len = at.distanceTo(to);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.6, 1, 28, 1, true), beamMaterial("#ffc27a"));
    beam.scale.set(1, len, 1);
    beam.position.copy(at).lerp(to, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().sub(to).normalize());
    group.add(beam);
    lamps.push({ halo, streak, beam, phase: i * 0.37 });
  }

  const tmp = new THREE.Vector3();
  const home = {};
  Object.entries(SPOTS).forEach(([k, p]) => { home[k] = new THREE.Vector3(...p); });

  return {
    name: "song",
    group,
    background: new THREE.Color("#07060a"),
    fog: new THREE.Fog("#07060a", 22, 70),
    environment: 0.12,
    bloom: 0.6,
    cast,
    you: youLabel,
    update(t, dt, info) {
      tickHair(t);
      const { split = 0, out = 0 } = info.params;
      const beat = t * 1.75;
      back.material.uniforms.uTime.value = t;
      // the truss burns steady, brighter once the band is apart
      lamps.forEach((l) => {
        const on = (0.55 + 0.45 * split) * (0.95 + 0.05 * Math.sin(t * 0.35 + l.phase * 3));
        l.halo.material.opacity = 0.75 * on;
        l.streak.material.opacity = 0.5 * on;
        l.beam.material.uniforms.uIntensity.value = 0.22 * on;
      });
      fx.mat.uniforms.uTime.value = t;
      fx.mat.uniforms.uScale.value = info.pointScale;
      hall.update(t, beat, 0.9);

      // Huddled together, then each steps out to their own spot.
      const spread = split * split * (3 - 2 * split);
      Object.entries(members).forEach(([k, m], i) => {
        const p = home[k];
        tmp.copy(HUDDLE).lerp(p, 0.35 + 0.65 * spread);
        tmp.y = k === "drums" ? p.y : 0;
        if (k === "drums") tmp.z = p.z;
        m.group.position.copy(tmp);
        // name tags show once apart, and clear away for the guitarist moment
        m.state.appear = range(split, 0.55 + i * 0.05, 0.9 + i * 0.02) * (1 - range(out, 0.05, 0.3));
        m.play(t, beat + i * 0.07, 0.9);
      });

      // Lights follow the story.
      wash.set(1 - range(split, 0.1, 0.7), 26);
      Object.entries(lights).forEach(([k, l], i) => {
        let v = range(split, 0.3 + i * 0.08, 0.7 + i * 0.06) * (0.96 + 0.04 * Math.sin(t * 0.3 + i));
        if (k === "guitar") v *= 1 - range(out, 0.0, 0.3);
        l.set(v);
      });

      // Take the guitar out: the guitarist burns away into embers...
      burn.uBurn.value = range(out, 0.05, 0.42);
      members.guitar.group.visible = burn.uBurn.value < 0.999;
      fx.mat.uniforms.uBurst.value = range(out, 0.05, 0.25) * (1 - range(out, 0.75, 1));
      // ...and you rise out of the fire in their place, and play.
      const reveal = range(out, 0.45, 0.95);
      youBurn.uBurn.value = 1 - reveal;
      you.group.visible = reveal > 0.001;
      you.play(t, beat + 0.14, 0.9);
      youLight.set(range(out, 0.55, 0.95), 22);
      ring.material.opacity = range(out, 0.3, 0.55) * (0.85 + 0.15 * Math.sin(t * 0.8));
      youLabel.material.opacity = range(out, 0.7, 1);
      youLabel.position.set(SPOTS.guitar[0], 2.35 + Math.sin(t * 2) * 0.04, SPOTS.guitar[2]);
    }
  };
}
