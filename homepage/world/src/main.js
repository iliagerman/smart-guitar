// Scroll-driven 3D worlds behind the landing page.
//
// Each chapter of the page ([data-shot]) is a camera shot in one of four sets
// (your room, inside the song, the notebook, the stage). Scrolling moves the
// camera between shots; moving to another set dives through a colour. The
// page text scrolls above the canvas. No external assets: every model,
// texture and sound is generated here.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createRoom } from "./sets/room.js";
import { createSong } from "./sets/song.js";
import { createNotebook } from "./sets/notebook.js";
import { createStage } from "./sets/stage.js";
import { unlockAudio, pluck, OPEN_STRINGS, E_MINOR } from "./audio.js";
import { clamp, damp, lerp, range, smooth, smoother } from "./util.js";

const root = document.documentElement;
const canvasEl = document.querySelector(".world-canvas");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
const saveData = navigator.connection && navigator.connection.saveData;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const pose = (pos, look, fov) => ({ pos, look, fov });

// Camera shots per set, in set-local space: [tall screens, wide screens].
const POSES = {
  room: {
    hero: [pose(V(0.22, 1.42, 2.3), V(0.14, 1.3, 0), 52), pose(V(0.75, 1.0, 2.05), V(-0.32, 0.76, 0), 38)],
    // you, on the edge of the bed, struggling with the chord
    struggle: [pose(V(-0.35, 1.3, 1.65), V(-1.05, 0.9, -0.45), 54), pose(V(0.35, 1.25, 1.55), V(-1.55, 0.85, -0.5), 44)],
    // the laptop opens on Smart Guitar and you play along
    help: [pose(V(-0.2, 1.2, 1.3), V(-0.85, 0.78, -0.6), 54), pose(V(0.1, 1.2, 1.25), V(-1.75, 0.72, -0.7), 44)],
    push: "hole",
    dive: "dive"
  },
  song: {
    // from high above the crowd, down to the stage, then onto your spot
    enter: [pose(V(0.8, 34, 36), V(0.8, 0, 4), 50), pose(V(-2, 30, 32), V(-2, 0, 4), 42)],
    one: [pose(V(0.8, 15, 21), V(0.8, 0.4, 0.5), 50), pose(V(-3.2, 13.5, 19), V(-3.2, 0.3, 0.4), 42)],
    split: [pose(V(0.7, 4.2, 14.5), V(0.7, 1.1, 0), 52), pose(V(-1.3, 3.3, 11.5), V(-2.1, 1.05, -0.2), 40)],
    out: [pose(V(2.6, 1.9, 6.6), V(2.9, 1.65, 0.3), 54), pose(V(0.6, 1.65, 5.6), V(1.1, 1.2, 0.2), 42)],
    // back up into the air, on the way to the practice notebook
    rise: [pose(V(0.8, 22, 16), V(0.8, 0, 0), 50), pose(V(-2, 20, 15), V(-2, 0, 0), 42)],
    // the stage, waiting: the guitarist's spot under the light
    spot: [pose(V(1.6, 2.6, 9.5), V(2.2, 1.2, 0.2), 52), pose(V(-0.4, 2.4, 8.4), V(0.4, 1.1, 0.1), 42)],
    exit: [pose(V(3.0, 1.15, 1.25), V(3.0, 1.05, 0.3), 50), pose(V(3.0, 1.15, 1.25), V(3.0, 1.05, 0.3), 50)]
  },
  notebook: {
    enter: [pose(V(0.2, 2.8, 0.25), V(0.2, 0, 0), 46), pose(V(0.1, 2.8, 0.25), V(0.1, 0, 0), 42)],
    desk: [pose(V(0.22, 1.5, 0.62), V(0.22, 0, -0.04), 46), pose(V(-0.45, 0.98, 0.8), V(-0.3, 0, -0.04), 40)],
    exit: [pose(V(0.25, 0.22, 0.02), V(0.25, 0, -0.1), 45), pose(V(0.25, 0.22, 0.02), V(0.25, 0, -0.1), 45)]
  },
  stage: {
    enter: [pose(V(0.3, 2.0, 18), V(0.3, 1.8, 0), 55), pose(V(0.4, 1.7, 15), V(0.4, 1.5, 0), 40)],
    front: [pose(V(0.4, 2.9, 7.4), V(0.4, 1.5, -0.4), 58), pose(V(-1.2, 3.15, 6.8), V(-1.0, 1.5, -0.4), 38)],
    tickets: [pose(V(-2.2, 4.6, 12), V(0.3, 2.8, -1), 58), pose(V(-4.6, 4.2, 7.8), V(0.2, 2.2, -1.2), 44)],
    side: [pose(V(2.6, 3.2, 11), V(0.2, 2.2, 0), 58), pose(V(4.8, 2.8, 6.6), V(-0.4, 1.6, -0.6), 44)],
    encore: [pose(V(0.95, 1.95, 1.2), V(0.95, 3.2, 10), 75), pose(V(0.95, 1.9, 1.25), V(0.95, 3.0, 10), 60)]
  }
};

// The page's chapters, in order. `exit`/`enter` poses and a dip colour are
// used when the next chapter is in a different set.
const SHOTS = {
  hero: { set: "room", pose: "hero", params: { help: 0 } },
  struggle: { set: "room", pose: "struggle", params: { help: 0 } },
  help: { set: "room", pose: "help", params: { help: 1 } },
  dive: { set: "room", pose: "push", exit: "dive", dip: "#140904", params: { help: 1 } },
  one: { set: "song", pose: "one", enter: "enter", params: { split: 0, out: 0 } },
  split: { set: "song", pose: "split", exit: "rise", dip: "#f6efe1", params: { split: 1, out: 0 } },
  learn: { set: "notebook", pose: "desk", enter: "enter", exit: "exit", dip: "#000000" },
  out: { set: "song", pose: "spot", enter: "enter", params: { split: 1, out: 0.42 } },
  you: { set: "song", pose: "out", exit: "exit", dip: "#000000", params: { split: 1, out: 1 } },
  stage: { set: "stage", pose: "front", enter: "enter", params: { encore: 0 } },
  tickets: { set: "stage", pose: "tickets", params: { encore: 0 } },
  players: { set: "stage", pose: "side", params: { encore: 0.15 } },
  encore: { set: "stage", pose: "encore", params: { encore: 1 } }
};

const OFFSETS = { room: V(0, 0, 0), song: V(300, 0, 0), notebook: V(600, 0, 0), stage: V(900, 0, 0) };
const BUILDERS = { room: createRoom, song: createSong, notebook: createNotebook, stage: createStage };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDip: { value: 0 },
    uDipColor: { value: new THREE.Color("#000") },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.02 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uDip, uVignette, uGrain; uniform vec3 uDipColor; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      // a little lens fringing toward the edges, as real glass does
      vec2 ca = d * 0.0025;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + ca).r;
      c.b = texture2D(tDiffuse, vUv - ca).b;
      float v = smoothstep(0.9, 0.25, length(d * vec2(1.0, 0.85)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      // gentle warm lift in the shadows
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 0.99, 0.94) + vec3(0.012, 0.006, 0.0), 0.6);
      float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * uGrain;
      c.rgb = mix(c.rgb, uDipColor, uDip);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`
};

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

if (canvasEl && !saveData && webglOk()) start();
else root.classList.add("world-off");

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: "high-performance", alpha: false });
  const maxRatio = coarse ? 1.5 : 2;
  let ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 140);

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // A single NaN pixel would be smeared over the whole screen by the bloom and
  // flash the frame black; replace any before it gets there.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = min(c, vec4(64.0)); }`
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.55, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // Sets are built one at a time so the first frame appears quickly.
  const sets = {};
  const order = ["room", "song", "notebook", "stage"];
  function build(name) {
    const s = BUILDERS[name]();
    s.group.position.copy(OFFSETS[name]);
    s.group.visible = false;
    scene.add(s.group);
    sets[name] = s;
    return s;
  }

  // ----- Chapters and scroll -----
  const chapters = Array.from(document.querySelectorAll("[data-shot]"));
  const shots = chapters.map((el) => ({ el, ...SHOTS[el.getAttribute("data-shot")] }));
  let centers = [];
  function measure() {
    centers = chapters.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
  }
  function scrollIndex() {
    const focus = window.scrollY + window.innerHeight / 2;
    if (focus <= centers[0]) return 0;
    for (let i = 0; i < centers.length - 1; i++) {
      if (focus < centers[i + 1]) return i + (focus - centers[i]) / (centers[i + 1] - centers[i]);
    }
    return centers.length - 1;
  }

  // ----- Poses -----
  let aspectMix = 1;
  function poseOf(setName, name) {
    const off = OFFSETS[setName];
    const def = POSES[setName][name];
    if (def === "hole" || def === "dive") {
      const h = sets.room.hole();
      if (def === "hole") {
        const tall = pose(h.p.clone().addScaledVector(h.n, 0.9).add(V(0, 0.05, 0)), h.p.clone().add(V(0, -0.1, 0)), 40);
        const wide = pose(h.p.clone().addScaledVector(h.n, 0.62).add(V(0.1, 0.08, 0)), h.p.clone().add(V(-0.13, 0, 0)), 30);
        return mixPose(tall, wide, aspectMix);
      }
      return pose(h.p.clone().addScaledVector(h.n, 0.015), h.p.clone().addScaledVector(h.n, -0.4), 58);
    }
    const m = mixPose(def[0], def[1], aspectMix);
    m.pos.add(off);
    m.look.add(off);
    return m;
  }
  function mixPose(a, b, t) {
    return { pos: a.pos.clone().lerp(b.pos, t), look: a.look.clone().lerp(b.look, t), fov: lerp(a.fov, b.fov, t) };
  }
  function mixParams(a = {}, b = {}, t) {
    const out = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => {
      out[k] = lerp(a[k] ?? b[k], b[k] ?? a[k], t);
    });
    return out;
  }

  // Works out where the camera is for a scroll position.
  function direct(w) {
    const i = Math.min(Math.floor(w), shots.length - 1);
    const f = w - i;
    const A = shots[i];
    const B = shots[Math.min(i + 1, shots.length - 1)];
    const g = smooth(range(f, 0.12, 0.88));
    if (A === B || !sets[B.set]) return { set: A.set, pose: poseOf(A.set, A.pose), params: A.params || {}, dip: 0, enter: null, dipColor: "#000" };
    if (A.set === B.set) {
      if (reduce) {
        const cut = g < 0.5 ? A : B;
        return { set: A.set, pose: poseOf(A.set, cut.pose), params: cut.params || {}, dip: 1 - Math.abs(g * 2 - 1) > 0.8 ? 0.6 : 0, enter: null, dipColor: sets[A.set].background.getStyle() };
      }
      return { set: A.set, pose: mixPose(poseOf(A.set, A.pose), poseOf(B.set, B.pose), smoother(g)), params: mixParams(A.params, B.params, g), dip: 0, enter: null };
    }
    // Different sets: fly toward A's exit, dip, fly in from B's entrance.
    const dipColor = A.dip || "#000";
    if (g < 0.5) {
      const e = g * 2;
      return { set: A.set, pose: mixPose(poseOf(A.set, A.pose), poseOf(A.set, A.exit), reduce ? 0 : e * e), params: A.params || {}, dip: smooth(range(e, 0.45, 1)), enter: null, dipColor };
    }
    const e = (g - 0.5) * 2;
    return { set: B.set, pose: mixPose(poseOf(B.set, B.enter), poseOf(B.set, B.pose), reduce ? 1 : 1 - (1 - e) * (1 - e)), params: B.params || {}, dip: 1 - smooth(range(e, 0, 0.55)), enter: e, dipColor };
  }

  // ----- Pointer: strum the strings, gently steer the camera -----
  const pointer = new THREE.Vector2(0, 0);
  const pointerSmooth = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  let lastString = -1;
  let pressed = false;
  let activeSet = "room";
  function strum(e, tap) {
    if (activeSet !== "room" || !sets.room) return;
    const r = canvasEl.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(sets.room.guitar.hits, false)[0];
    const s = hit ? hit.object.userData.string : -1;
    if (s >= 0 && (s !== lastString || tap)) {
      sets.room.guitar.pluck(s, tap ? 1 : 0.7);
      pluck(OPEN_STRINGS[s], tap ? 1 : 0.7);
      root.classList.add("world-strummed");
    }
    lastString = s;
  }
  window.addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    if (e.target === canvasEl && (!coarse || pressed)) strum(e, false);
  }, { passive: true });
  canvasEl.addEventListener("pointerdown", (e) => {
    pressed = true;
    unlockAudio();
    strum(e, true);
  });
  window.addEventListener("pointerup", () => { pressed = false; lastString = -1; });

  // Any click, tap or key press unlocks sound (Safari needs a real gesture;
  // hovering is not one). The hero's sound button also strums an E minor.
  ["pointerdown", "touchend", "click", "keydown"].forEach((type) => {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-sound-on]")) return;
    unlockAudio();
    root.classList.add("world-sound");
    E_MINOR.forEach((f, i) => {
      pluck(f, 0.85, i * 0.045);
      setTimeout(() => { if (sets.room) sets.room.guitar.pluck(i, 0.9); }, i * 45);
    });
  });

  // ----- Live demo state (who is playing) -----
  const demoRoot = document.querySelector(".demo");
  const demoMembers = demoRoot ? Array.from(demoRoot.querySelectorAll(".mem[data-stem]")) : [];
  const demo = { playing: false, muted: {} };
  function readDemo() {
    demo.playing = !!demoRoot && demoRoot.classList.contains("is-playing");
    demoMembers.forEach((b) => { demo.muted[b.getAttribute("data-stem")] = b.getAttribute("aria-pressed") === "false"; });
  }

  // ----- Floating name tags over the musicians -----
  const tags = {};
  document.querySelectorAll(".world-tag[data-tag]").forEach((el) => { tags[el.getAttribute("data-tag")] = el; });
  const tagPos = new THREE.Vector3();
  // Tags never sit on top of the page's text or the demo card.
  const blockers = Array.from(document.querySelectorAll(".chapter .copy, .demo, .ticket, .quote"));
  function placeTags(set) {
    const cast = set && set.cast;
    const blocked = blockers.map((b) => b.getBoundingClientRect()).filter((r) => r.bottom > 0 && r.top < window.innerHeight);
    Object.entries(tags).forEach(([k, el]) => {
      const c = cast && cast[k];
      if (!c || !c.group.visible || c.state.appear < 0.6) {
        el.classList.remove("is-on");
        return;
      }
      c.group.localToWorld(tagPos.copy(c.anchor));
      tagPos.project(camera);
      const x = ((tagPos.x + 1) / 2) * window.innerWidth;
      const y = ((1 - tagPos.y) / 2) * window.innerHeight;
      const covered = blocked.some((r) => x > r.left - 50 && x < r.right + 50 && y > r.top - 20 && y < r.bottom + 20);
      const visible = tagPos.z < 1 && Math.abs(tagPos.x) < 1.05 && Math.abs(tagPos.y) < 1.05 && !covered;
      el.classList.toggle("is-on", visible);
      if (visible) el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  // ----- Size and quality -----
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    bloom.setSize(w * ratio * 0.5, h * ratio * 0.5);
    camera.aspect = w / h;
    aspectMix = clamp((w / h - 0.75) / (1.35 - 0.75));
    measure();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("load", measure);
  new ResizeObserver(measure).observe(document.body);

  let slowFrames = 0;
  function adapt(dt) {
    slowFrames = dt > 1 / 38 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames > 90 && ratio > 0.75) {
      ratio = Math.max(0.75, ratio - 0.25);
      renderer.setPixelRatio(ratio);
      resize();
      slowFrames = 0;
    } else if (slowFrames > 90 && bloom.enabled) {
      bloom.enabled = false;
      slowFrames = 0;
    }
  }

  // ----- Loop -----
  let ws = 0;
  let last = performance.now();
  let t = 0;
  let firstFrame = true;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const w = scrollIndex();
    ws = reduce ? w : damp(ws, w, 5.5, dt);
    const shot = direct(ws);
    if (!sets[shot.set]) return;
    activeSet = shot.set;
    order.forEach((n) => { if (sets[n]) sets[n].group.visible = n === shot.set; });
    const set = sets[shot.set];
    scene.background = set.background;
    scene.fog = set.fog;
    scene.environmentIntensity = set.environment;
    bloom.strength = set.bloom;

    camPos.copy(shot.pose.pos);
    camLook.copy(shot.pose.look);
    if (!reduce) {
      // hand-held drift and a touch of pointer parallax
      const dist = camPos.distanceTo(camLook);
      pointerSmooth.x = damp(pointerSmooth.x, coarse ? 0 : pointer.x, 3, dt);
      pointerSmooth.y = damp(pointerSmooth.y, coarse ? 0 : pointer.y, 3, dt);
      camera.matrixWorld.extractBasis(right, up, fwd);
      camPos.addScaledVector(right, (Math.sin(t * 0.31) * 0.012 + pointerSmooth.x * 0.03) * dist);
      camPos.addScaledVector(up, (Math.cos(t * 0.23) * 0.01 - pointerSmooth.y * 0.02) * dist);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (Math.abs(camera.fov - shot.pose.fov) > 0.01) {
      camera.fov = shot.pose.fov;
      camera.updateProjectionMatrix();
    }

    readDemo();
    const pointScale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 900;
    set.update(t, dt, { camera, params: shot.params, enter: shot.enter, demo, pointScale });

    grade.uniforms.uTime.value = t;
    grade.uniforms.uDip.value = shot.dip;
    if (shot.dipColor) grade.uniforms.uDipColor.value.set(shot.dipColor);
    composer.render(dt);
    placeTags(set);
    root.setAttribute("data-world", shot.set);
    if (firstFrame) {
      firstFrame = false;
      root.classList.add("world-on");
    }
    adapt(dt);
  }

  resize();
  // Phones get smaller shadow maps.
  const capShadows = (group) => group.traverse((o) => {
    if (o.isLight && o.shadow && coarse) o.shadow.mapSize.set(Math.min(1024, o.shadow.mapSize.x), Math.min(1024, o.shadow.mapSize.y));
  });
  const room = build("room");
  capShadows(room.group);
  room.group.visible = true;
  scene.fog = room.fog;
  camera.position.set(0, 1, 3);
  renderer.compile(scene, camera);
  requestAnimationFrame(frame);

  // Build the other worlds in the background, then draw each one once into a
  // small off-screen target. That uploads its textures and compiles its
  // shaders (shadows included) with its own lights, so the first time you
  // scroll into it there is nothing left to stall on.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  const warmTarget = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
  function warm(s) {
    const others = order.filter((n) => n !== s.name && sets[n]).map((n) => [n, sets[n].group.visible]);
    const culled = [];
    const fog = scene.fog;
    const bg = scene.background;
    s.group.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => { if (v && v.isTexture) renderer.initTexture(v); });
        if (m.uniforms) Object.values(m.uniforms).forEach((u) => { if (u.value && u.value.isTexture) renderer.initTexture(u.value); });
      });
    });
    others.forEach(([n]) => { sets[n].group.visible = false; });
    s.group.visible = true;
    scene.fog = s.fog;
    scene.background = s.background;
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    s.group.visible = false;
    scene.fog = fog;
    scene.background = bg;
    others.forEach(([n, v]) => { sets[n].group.visible = v; });
    culled.forEach((o) => { o.frustumCulled = true; });
  }
  let k = 1;
  function next() {
    if (k >= order.length) return;
    const s = build(order[k++]);
    capShadows(s.group);
    measure();
    idle(() => {
      warm(s);
      idle(next, { timeout: 800 });
    }, { timeout: 800 });
  }
  idle(next, { timeout: 800 });
}
