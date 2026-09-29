// The concert around the song's band: a raised stage with speaker stacks, a
// floor packed with fans holding up lighters and phones, and searchlights
// sweeping slowly over the crowd. Seen from high above first, then the camera
// comes down to the stage.
import * as THREE from "three";
import { crowdGeometry } from "./stage.js";
import { glowSprite } from "../textures.js";

const PIT = -1.3; // the audience floor, below the stage deck

export function concertHall(group, rand, beamMaterial) {
  // stage deck and its front edge, with a warm strip of light along the lip
  const deckMat = new THREE.MeshStandardMaterial({ color: "#0c0807", roughness: 0.55, metalness: 0.1 });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(17, 8), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0.8, 0, -1.6);
  deck.receiveShadow = true;
  group.add(deck);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(17, -PIT, 0.2), new THREE.MeshStandardMaterial({ color: "#080606", roughness: 0.9 }));
  lip.position.set(0.8, PIT / 2, 2.4);
  group.add(lip);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(17, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a2a").multiplyScalar(2.2) }));
  strip.position.set(0.8, -0.04, 2.52);
  group.add(strip);
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), new THREE.MeshStandardMaterial({ color: "#060505", roughness: 0.95 }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(0.8, PIT, 26);
  group.add(pit);

  // speaker stacks either side of the stage
  const cab = new THREE.MeshStandardMaterial({ color: "#0d0b0b", roughness: 0.8 });
  const grille = new THREE.MeshStandardMaterial({ color: "#1a1614", roughness: 1 });
  [-7.6, 9.2].forEach((x) => {
    for (let k = 0; k < 4; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 1.0), cab);
      box.position.set(x, PIT + 0.48 + k * 0.97, 1.8);
      group.add(box);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8), grille);
      g.position.set(x, box.position.y, 2.31);
      group.add(g);
    }
  });

  // the crowd: silhouettes in rows widening away from the stage
  const crowdMat = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: true });
  const DOWN = 900;
  const UP = 380;
  const downMesh = new THREE.InstancedMesh(crowdGeometry(false), crowdMat, DOWN);
  const upMesh = new THREE.InstancedMesh(crowdGeometry(true), crowdMat, UP);
  const fans = [];
  const tint = new THREE.Color();
  let di = 0;
  let ui = 0;
  for (let row = 0; row < 30; row++) {
    const z = 3.3 + row * 0.6 + rand() * 0.2;
    const half = 6.5 + row * 0.35;
    const n = Math.round(half * 2 / 0.62);
    for (let i = 0; i < n; i++) {
      const x = 0.8 - half + (i / (n - 1)) * half * 2 + (rand() - 0.5) * 0.35;
      const up = rand() < 0.3 && ui < UP;
      if (!up && di >= DOWN) continue;
      tint.setHSL(0.05, 0.4, 0.02 + rand() * 0.025);
      const mesh = up ? upMesh : downMesh;
      const idx = up ? ui++ : di++;
      mesh.setColorAt(idx, tint);
      fans.push({ mesh, idx, x, z, h: 0.9 + rand() * 0.2, phase: rand(), rot: (rand() - 0.5) * 0.5, up });
    }
  }
  downMesh.count = di;
  upMesh.count = ui;
  [downMesh, upMesh].forEach((m) => { m.instanceColor.needsUpdate = true; m.frustumCulled = false; group.add(m); });

  // lighters and phone screens held up over the crowd
  const holders = fans.filter((f) => f.up);
  const lp = new Float32Array(holders.length * 3);
  const lc = new Float32Array(holders.length * 3);
  holders.forEach((f, i) => {
    const phone = rand() < 0.5;
    lc.set(phone ? [0.75, 0.85, 1.0] : [1.0, 0.72, 0.35], i * 3);
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
  const lights = new THREE.Points(lg, new THREE.PointsMaterial({ map: glowSprite(), size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  lights.frustumCulled = false;
  group.add(lights);

  // searchlights from the truss, sweeping slowly over the crowd
  const sweeps = [-3.2, -0.4, 2.4, 5.2].map((x, i) => {
    const from = new THREE.Vector3(x, 5.6, -4.0);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.3, 1, 28, 1, true), beamMaterial(i % 2 ? "#ffd59a" : "#ffb070"));
    group.add(beam);
    return { from, beam, i };
  });
  const to = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dummy = new THREE.Object3D();

  return {
    update(t, beat, energy) {
      // fans bob with the beat, arms up sway
      let li = 0;
      for (const f of fans) {
        const b = Math.abs(Math.sin((beat + f.phase) * Math.PI));
        dummy.position.set(f.x, PIT + b * 0.05 * energy, f.z);
        dummy.rotation.set(0, f.rot, f.up ? Math.sin(t * 0.8 + f.phase * 6) * 0.08 : 0);
        dummy.scale.set(1, f.h, 1);
        dummy.updateMatrix();
        f.mesh.setMatrixAt(f.idx, dummy.matrix);
        if (f.up) {
          const sway = Math.sin(t * 0.8 + f.phase * 6) * 0.08;
          lp[li * 3] = f.x + 0.3 + sway * 1.7;
          lp[li * 3 + 1] = PIT + 1.78 * f.h + b * 0.05 * energy;
          lp[li * 3 + 2] = f.z;
          li++;
        }
      }
      downMesh.instanceMatrix.needsUpdate = true;
      upMesh.instanceMatrix.needsUpdate = true;
      lg.attributes.position.needsUpdate = true;
      for (const s of sweeps) {
        to.set(0.8 + Math.sin(t * 0.16 + s.i * 1.7) * 7, PIT, 11 + Math.cos(t * 0.12 + s.i * 2.3) * 6);
        const len = s.from.distanceTo(to);
        s.beam.scale.set(1, len, 1);
        s.beam.position.copy(s.from).lerp(to, 0.5);
        s.beam.quaternion.setFromUnitVectors(up, to.clone().sub(s.from).normalize());
        s.beam.material.uniforms.uIntensity.value = 0.35;
      }
    }
  };
}
