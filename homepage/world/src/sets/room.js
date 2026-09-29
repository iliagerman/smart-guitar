// World 1: your room at night. You sit on the edge of the bed fighting a chord
// you can't get yet. The other guitar waits on its stand; the lamp on the
// amp keeps looking at it (and now and then at you). Dust drifts in the light.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createGuitar, SOUNDHOLE } from "../guitar.js";
import { createLamp } from "../characters.js";
import { woodTexture, wallpaperTexture, fabricTexture, rugTexture, nightSkyTexture, glowSprite, canvas, toTexture } from "../textures.js";
import { lerp, rng } from "../util.js";
import { strugglingPlayer, tickHair } from "../band.js";

function posterTexture(seed, a, b, c) {
  const [cv, ctx] = canvas(512, 720);
  const rand = rng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 720);
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(256, 300, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  for (let i = 0; i < 9; i++) ctx.fillRect(0, 380 + i * 22, 512, 9 + rand() * 4);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(60, 610, 392, 18);
  ctx.fillRect(120, 645, 272, 10);
  return toTexture(cv);
}

function amp() {
  const g = new THREE.Group();
  const tolex = new THREE.MeshStandardMaterial({ map: fabricTexture("#1c1714", null, 14), roughness: 0.85 });
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.5, 0.32, 3, 0.03), tolex);
  box.position.y = 0.25;
  box.castShadow = box.receiveShadow = true;
  g.add(box);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshStandardMaterial({ map: fabricTexture("#5a4636", "#6b5541", 15), roughness: 0.95 }));
  cloth.position.set(0, 0.21, 0.161);
  g.add(cloth);
  const piping = new THREE.MeshStandardMaterial({ color: "#d8b46a", metalness: 0.8, roughness: 0.3 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.008, 0.004), piping);
  trim.position.set(0, 0.385, 0.162);
  g.add(trim);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.01), new THREE.MeshStandardMaterial({ color: "#2b2522", roughness: 0.4 }));
  panel.position.set(0, 0.44, 0.158);
  g.add(panel);
  const knob = new THREE.CylinderGeometry(0.014, 0.016, 0.02, 20);
  const chrome = new THREE.MeshStandardMaterial({ color: "#f0f0f0", metalness: 1, roughness: 0.2 });
  for (let i = 0; i < 6; i++) {
    const k = new THREE.Mesh(knob, chrome);
    k.rotation.x = Math.PI / 2;
    k.position.set(-0.2 + i * 0.06, 0.44, 0.17);
    g.add(k);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff3b1f").multiplyScalar(6) }));
  led.position.set(0.24, 0.44, 0.166);
  g.add(led);
  return g;
}

function stand() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color: "#141316", roughness: 0.35, clearcoat: 0.6 });
  const tube = (a, b, r = 0.011) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    g.add(m);
  };
  tube(new THREE.Vector3(-0.2, 0.01, 0.16), new THREE.Vector3(-0.12, 0.13, 0.05));
  tube(new THREE.Vector3(0.2, 0.01, 0.16), new THREE.Vector3(0.12, 0.13, 0.05));
  tube(new THREE.Vector3(-0.14, 0.13, 0.06), new THREE.Vector3(0.14, 0.13, 0.06), 0.014);
  tube(new THREE.Vector3(0, 0.01, -0.34), new THREE.Vector3(0, 0.78, -0.14));
  tube(new THREE.Vector3(0, 0.13, 0.06), new THREE.Vector3(0, 0.3, -0.26));
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 8, 20, Math.PI), mat);
  yoke.position.set(0, 0.8, -0.13);
  yoke.rotation.x = -0.2;
  g.add(yoke);
  return g;
}

export function createRoom() {
  const group = new THREE.Group();
  const rand = rng(99);

  // Floor, walls, rug.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshPhysicalMaterial({ map: woodTexture({ base: "#6b3f24", dark: "#2a140a", light: "#a1693f", seed: 2, planks: 8, repeat: [3, 3] }), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Dusty indigo walls so the warm lamp and fairy lights glow against them.
  const wallMat = new THREE.MeshStandardMaterial({ map: wallpaperTexture("#1e1411", "#261915", "#3b241a"), roughness: 0.92 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.2), wallMat);
  back.position.set(0, 2.1, -1.6);
  back.receiveShadow = true;
  group.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.2), wallMat);
  side.position.set(-2.6, 2.1, 1.4);
  side.rotation.y = Math.PI / 2;
  side.receiveShadow = true;
  group.add(side);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: "#3a241c", roughness: 0.6 }));
  skirting.position.set(0, 0.06, -1.585);
  group.add(skirting);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25, 72), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.1, 0.004, 0.2);
  rug.receiveShadow = true;
  group.add(rug);

  // Window with the night city and a moon.
  const win = new THREE.Group();
  win.position.set(1.25, 1.62, -1.585);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), new THREE.MeshBasicMaterial({ map: nightSkyTexture() }));
  sky.position.z = -0.02;
  win.add(sky);
  const frameMat = new THREE.MeshPhysicalMaterial({ color: "#efe4d2", roughness: 0.5, clearcoat: 0.3 });
  const bar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), frameMat);
    m.position.set(x, y, 0.01);
    m.castShadow = true;
    win.add(m);
  };
  bar(1.32, 0.06, 0, 0.68);
  bar(1.32, 0.06, 0, -0.68);
  bar(0.06, 1.42, -0.63, 0);
  bar(0.06, 1.42, 0.63, 0);
  bar(0.035, 1.3, 0, 0);
  bar(1.2, 0.035, 0, 0.1);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.2), frameMat);
  sill.position.set(0, -0.72, 0.08);
  win.add(sill);
  group.add(win);

  const curtainMat = new THREE.MeshPhysicalMaterial({ map: fabricTexture("#5a1208", null, 17, 0.05, 2), roughness: 0.8, sheen: 1, sheenColor: "#ff7a3d", side: THREE.DoubleSide });
  const curtains = [-0.86, 0.86].map((x) => {
    const geo = new THREE.PlaneGeometry(0.42, 2.3, 24, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 38) * 0.035);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, curtainMat);
    m.position.set(1.25 + x, 1.55, -1.5);
    m.castShadow = true;
    group.add(m);
    return m;
  });

  // Posters.
  [[-1.25, 1.85, 71, "#1a0503", "#ea580c", "#fde047"], [-0.45, 2.0, 72, "#0a0a0a", "#dc2626", "#fb923c"]].forEach(([x, y, seed, a, b, c]) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.025), new THREE.MeshStandardMaterial({ color: "#1b1512", roughness: 0.5 }));
    frame.position.set(x, y, -1.585);
    group.add(frame);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ map: posterTexture(seed, a, b, c), roughness: 0.6 }));
    art.position.set(x, y, -1.57);
    group.add(art);
  });

  // Fairy lights sagging across the back wall.
  const bulbGeo = new THREE.SphereGeometry(0.014, 12, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb95c").multiplyScalar(5) });
  const wirePts = [];
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, 34);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 34; i++) {
    const u = i / 33;
    const x = -2.4 + u * 4.2;
    const y = 2.34 - Math.sin(u * Math.PI) * 0.22 - Math.sin(u * Math.PI * 3) * 0.04;
    wirePts.push(new THREE.Vector3(x, y, -1.56));
    m4.makeTranslation(x, y - 0.03, -1.55);
    bulbs.setMatrixAt(i, m4);
  }
  group.add(bulbs);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePts), 120, 0.002, 4), new THREE.MeshBasicMaterial({ color: "#1a120c" })));
  const glowL = new THREE.PointLight("#ff9a4a", 1.4, 3.2, 1.6);
  glowL.position.set(-1.2, 2.3, -1.2);
  const glowR = new THREE.PointLight("#ff9a4a", 1.0, 3, 1.6);
  glowR.position.set(0.9, 2.3, -1.2);
  group.add(glowL, glowR);

  // Guitar on its stand, leaning back a little.
  const guitar = createGuitar();
  const guitarRig = new THREE.Group();
  guitarRig.position.set(0.12, 0.38, 0.1);
  guitarRig.rotation.set(-0.16, -0.14, 0);
  guitarRig.add(guitar.group);
  group.add(guitarRig);
  const guitarStand = stand();
  guitarStand.position.set(0.12, 0, 0.1);
  guitarStand.rotation.y = -0.14;
  group.add(guitarStand);

  // Your bed, with you on the edge of it, still fighting the same chord.
  // Printed tabs on the blanket and crumpled ones on the floor.
  const bed = new THREE.Group();
  bed.position.set(-1.45, 0, -0.95);
  group.add(bed);
  const bedWood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: "#3a2416", dark: "#150b06", light: "#5a3a24", seed: 61 }), roughness: 0.6 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.28, 1.05, 3, 0.03), bedWood);
  base.position.y = 0.14;
  bed.add(base);
  const mattress = new THREE.Mesh(new RoundedBoxGeometry(1.95, 0.2, 1.0, 4, 0.08), new THREE.MeshStandardMaterial({ map: fabricTexture("#5b1c14", "#3a100b", 41), roughness: 0.95 }));
  mattress.position.y = 0.38;
  mattress.receiveShadow = true;
  bed.add(mattress);
  const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.12, 0.36, 4, 0.06), new THREE.MeshStandardMaterial({ color: "#d9cfc0", roughness: 0.95 }));
  pillow.position.set(-0.62, 0.53, -0.2);
  pillow.rotation.y = 0.1;
  bed.add(pillow);
  const [tc, tctx] = canvas(256, 340);
  tctx.fillStyle = "#f2ede4";
  tctx.fillRect(0, 0, 256, 340);
  tctx.fillStyle = "#1e2a4a";
  tctx.font = "700 22px Inter, sans-serif";
  tctx.fillText("TAB", 18, 34);
  for (let l = 0; l < 4; l++) {
    for (let s2 = 0; s2 < 6; s2++) tctx.fillRect(18, 60 + l * 68 + s2 * 8, 220, 1);
    for (let k = 0; k < 7; k++) tctx.fillText(String(Math.floor(rand() * 4)), 26 + k * 30, 64 + l * 68 + Math.floor(rand() * 6) * 8);
  }
  const tabMat = new THREE.MeshStandardMaterial({ map: toTexture(tc), roughness: 0.9 });
  [[0.1, -0.1, 0.3], [0.45, 0.12, -0.25]].forEach(([x, z, r]) => {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), tabMat);
    sheet.rotation.set(-Math.PI / 2, 0, r);
    sheet.position.set(x, 0.485, z);
    bed.add(sheet);
  });
  const paperMat = new THREE.MeshStandardMaterial({ color: "#e8e2d6", roughness: 0.9, flatShading: true });
  for (let k = 0; k < 4; k++) {
    const geo = new THREE.IcosahedronGeometry(0.05, 1);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (0.75 + rand() * 0.5), pp.getY(i) * (0.75 + rand() * 0.5), pp.getZ(i) * (0.75 + rand() * 0.5));
    geo.computeVertexNormals();
    const ball = new THREE.Mesh(geo, paperMat);
    ball.position.set(-1.1 + k * 0.35 + rand() * 0.1, 0.045, 0.1 + rand() * 0.4);
    group.add(ball);
  }
  const you = strugglingPlayer();
  you.group.position.set(-1.1, 0, -0.42);
  you.group.rotation.y = 0.32;
  you.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(you.group);
  // The laptop on the bed: closed while you struggle, then open on Smart
  // Guitar, with the burning guitar, the song, the chord you're on and the
  // band with the guitar part marked as yours.
  const [sc, sctx] = canvas(640, 400);
  const screenTex = toTexture(sc);
  const logo = new Image();
  logo.src = "assets/logo-flame.jpg";
  const CHORDS = ["Em", "G", "D", "A7sus4"];
  let lastChord = -1;
  function drawScreen(chord, progress) {
    const x = sctx;
    x.fillStyle = "#07060a";
    x.fillRect(0, 0, 640, 400);
    const glow = x.createRadialGradient(470, 170, 10, 470, 170, 260);
    glow.addColorStop(0, "rgba(249,115,22,0.35)");
    glow.addColorStop(1, "rgba(249,115,22,0)");
    x.fillStyle = glow;
    x.fillRect(0, 0, 640, 400);
    if (logo.complete && logo.naturalWidth) x.drawImage(logo, 360, 20, 230, 230);
    x.fillStyle = "#fff";
    x.font = "32px 'Bebas Neue', Inter, sans-serif";
    x.fillText("SMART", 34, 52);
    x.fillStyle = "#f97316";
    x.fillText("GUITAR", 134, 52);
    x.fillStyle = "#a8a29e";
    x.font = "600 18px Inter, sans-serif";
    x.fillText("Wonderwall · Oasis", 34, 100);
    x.fillStyle = "#fde047";
    x.font = "800 92px 'JetBrains Mono', monospace";
    x.fillText(CHORDS[chord], 34, 200);
    x.fillStyle = "#78716c";
    x.font = "700 20px Inter, sans-serif";
    x.fillText("next  " + CHORDS[(chord + 1) % 4], 38, 236);
    // the band: every track, with the guitar marked as yours
    ["Vocals", "YOU", "Drums", "Bass", "Keys"].forEach((name, i) => {
      const bx = 34 + i * 118;
      x.fillStyle = name === "YOU" ? "#f97316" : "rgba(255,255,255,0.08)";
      x.beginPath();
      x.roundRect(bx, 280, 106, 40, 20);
      x.fill();
      x.fillStyle = name === "YOU" ? "#fff" : "#d6d3d1";
      x.font = "700 16px Inter, sans-serif";
      x.textAlign = "center";
      x.fillText(name, bx + 53, 306);
      x.textAlign = "left";
    });
    x.fillStyle = "rgba(255,255,255,0.12)";
    x.fillRect(34, 352, 572, 6);
    x.fillStyle = "#f97316";
    x.fillRect(34, 352, 572 * progress, 6);
    screenTex.needsUpdate = true;
  }
  drawScreen(0, 0);
  const laptop = new THREE.Group();
  laptop.position.set(-0.52, 0.49, -0.78);
  laptop.rotation.y = -0.55;
  group.add(laptop);
  const alu = new THREE.MeshStandardMaterial({ color: "#3a3a40", metalness: 0.7, roughness: 0.35 });
  const deckL = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.016, 0.25, 2, 0.006), alu);
  deckL.position.y = 0.008;
  laptop.add(deckL);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.016, -0.12);
  laptop.add(hinge);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.24, 0.01, 2, 0.004), alu);
  lid.position.set(0, 0.12, -0.006);
  hinge.add(lid);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.206), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 0.12, 0.0005);
  hinge.add(screen);
  const screenLight = new THREE.PointLight("#ff9a4a", 0, 2.4, 1.6);
  screenLight.position.set(-0.5, 0.75, -0.55);
  group.add(screenLight);
  let helpNow = 0;

  const bedLight = new THREE.PointLight("#ffb070", 2.4, 3.2, 1.6);
  bedLight.position.set(-0.6, 1.7, 0.4);
  group.add(bedLight);

  // Amp with the lamp on top.
  const ampMesh = amp();
  ampMesh.position.set(0.8, 0, -0.8);
  ampMesh.rotation.y = -0.35;
  group.add(ampMesh);
  const lamp = createLamp({ light: 9 });
  lamp.group.position.set(0.8, 0.5, -0.82);
  group.add(lamp.group);

  // Moonlight through the window and a soft fill.
  const moon = new THREE.SpotLight("#ffb07a", 12, 12, 0.5, 0.6, 1.4);
  moon.position.set(1.8, 2.6, -3.2);
  moon.target.position.set(0.2, 0, 0.6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.bias = -0.0005;
  group.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight("#5a2a18", "#1a0c06", 0.45);
  group.add(hemi);
  const rim = new THREE.PointLight("#ff7a2e", 2.2, 4, 1.8);
  rim.position.set(1.4, 1.2, 1.4);
  group.add(rim);

  // Dust motes in the light.
  const n = 380;
  const pos = new Float32Array(n * 3);
  const seedArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -1.6 + rand() * 3.2;
    pos[i * 3 + 1] = 0.2 + rand() * 2.4;
    pos[i * 3 + 2] = -1.2 + rand() * 2.4;
    seedArr[i] = rand() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute("seed", new THREE.BufferAttribute(seedArr, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glowSprite() }, uScale: { value: 1 } },
    vertexShader: `
      attribute float seed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.13 + seed)*0.18; p.y += sin(uTime*0.09 + seed*1.7)*0.22; p.z += cos(uTime*0.11 + seed)*0.15;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (3.0 + 3.0*fract(seed)) / -mv.z;
        vA = 0.25 + 0.75*abs(sin(uTime*0.7 + seed*3.1));
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0,0.82,0.58)*1.6, t.a*vA*0.55); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  group.add(dust);

  // Useful points in world space (after the set is placed).
  const holeLocal = SOUNDHOLE.clone();
  const holeNormalLocal = new THREE.Vector3(0, 0, 1);
  const guitarCenter = new THREE.Vector3();
  let glance = 0;
  const lookTarget = new THREE.Vector3();

  return {
    name: "room",
    group,
    background: new THREE.Color("#120a0c"),
    fog: new THREE.Fog("#120a0c", 7, 16),
    environment: 0.28,
    bloom: 0.5,
    guitar,
    hole() {
      guitar.group.updateWorldMatrix(true, false);
      const p = holeLocal.clone().applyMatrix4(guitar.group.matrixWorld);
      const nrm = holeNormalLocal.clone().transformDirection(guitar.group.matrixWorld);
      return { p, n: nrm };
    },
    update(t, dt, info) {
      dustMat.uniforms.uTime.value = t;
      dustMat.uniforms.uScale.value = info.pointScale;
      guitar.update(dt);
      tickHair(t);
      const help = (info.params && info.params.help) || 0;
      helpNow += (help - helpNow) * (1 - Math.exp(-dt * 3));
      you.play(t, help, dt);
      // the laptop opens, lights up, and follows the song
      hinge.rotation.x = lerp(Math.PI / 2 - 0.02, -0.28, helpNow);
      screen.visible = helpNow > 0.05;
      screenLight.intensity = 3.2 * helpNow;
      const chord = Math.floor((t * 1.6) / 4) % 4;
      if (helpNow > 0.05 && (chord !== lastChord || Math.floor(t * 4) % 2 === 0)) {
        lastChord = chord;
        drawScreen(chord, (t * 0.04) % 1);
      }
      you.guitar.update(dt);
      curtains.forEach((c, i) => { c.rotation.y = Math.sin(t * 0.6 + i) * 0.03; });
      // The lamp watches the guitar, and every few seconds glances at you.
      guitar.group.getWorldPosition(guitarCenter);
      guitarCenter.y += 0.05;
      const cycle = t % 9;
      glance = cycle > 6.4 && cycle < 8.2 ? 1 : 0;
      lookTarget.copy(guitarCenter).lerp(info.camera.position, glance * 0.9);
      lamp.update(t, dt, lookTarget);
      lamp.spot.intensity = 9 * (0.97 + Math.sin(t * 13) * 0.01 + Math.sin(t * 3.1) * 0.02);
    }
  };
}
