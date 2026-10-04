import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, EXTRACTION, randomSeed, blocked, isIlluminated } from '../shared/world.js';

const C = { amber: 0xf3b967, cyan: 0x8ad0c9, red: 0xe07855, green: 0xa8c7a0 };
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const matCache = new Map();
const material = (color, roughness = 0.8, metalness = 0.1) => {
  const key = `${color}-${roughness}-${metalness}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return matCache.get(key);
};
function box(parent, x, y, z, w, h, d, mat, rotation = 0) {
  const mesh = new THREE.Mesh(boxGeo, typeof mat === 'number' ? material(mat) : mat);
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.y = rotation; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(parent, x, y, z, radius, h, mat) {
  const mesh = new THREE.Mesh(cylinderGeo, typeof mat === 'number' ? material(mat) : mat);
  mesh.position.set(x, y, z); mesh.scale.set(radius, h, radius); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function sphere(parent, x, y, z, radius, mat) {
  const mesh = new THREE.Mesh(sphereGeo, typeof mat === 'number' ? material(mat) : mat);
  mesh.position.set(x, y, z); mesh.scale.setScalar(radius); mesh.castShadow = true; parent.add(mesh); return mesh;
}
function emissive(color, intensity = 1.5) { return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.35 }); }
function textureCanvas(w, h, paint) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; paint(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; return texture;
}
function signTexture(text, subtext = '', color = '#bfc6b3', bg = '#25332f') {
  return textureCanvas(512, 128, (ctx, w, h) => { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#b5c3ae55'; ctx.lineWidth = 2; ctx.strokeRect(9, 9, w - 18, h - 18); ctx.fillStyle = color; ctx.font = 'bold 46px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, subtext ? 66 : 81); if (subtext) { ctx.fillStyle = '#a9b39d'; ctx.font = '17px monospace'; ctx.fillText(subtext, w / 2, 101); } });
}
function batch(group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map();
  group.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    const source = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    const parts = Array.isArray(obj.material) ? source.groups.map(g => ({ start: g.start, count: g.count, material: obj.material[g.materialIndex] })) : [{ start: 0, count: source.attributes.position.count, material: obj.material }];
    for (const part of parts) {
      const key = part.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { material: part.material, geos: [] });
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(source.attributes)) geo.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(part.start * attr.itemSize, (part.start + part.count) * attr.itemSize), attr.itemSize));
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld)); buckets.get(key).geos.push(geo);
    }
    source.dispose();
  });
  group.clear();
  for (const value of buckets.values()) {
    const geo = mergeGeometries(value.geos, false);
    for (const part of value.geos) part.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, value.material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
}
function disposeGroup(group) {
  const shared = new Set(matCache.values());
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(obj => {
    if (obj.isMesh && ![boxGeo, cylinderGeo, sphereGeo].includes(obj.geometry)) geometries.add(obj.geometry);
    if (!obj.material) return;
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (!shared.has(mat)) materials.add(mat);
      if (mat.map) textures.add(mat.map);
    }
  });
  for (const geo of geometries) geo.dispose();
  for (const mat of materials) mat.dispose();
  for (const texture of textures) texture.dispose();
  group.removeFromParent();
}
function groundLabel(parent, text, x, z, w = 13, color = '#929b7b') {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, '', color, '#192525'), transparent: true, opacity: 0.48, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.035, z); parent.add(mesh); return mesh;
}
export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0c1a22); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.shadowAt = 0;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0d1b23); this.scene.fog = new THREE.FogExp2(0x10242a, 0.009);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.15, 300);
    this.camera.position.set(28, 32, 48); this.camera.lookAt(0, 2, 0);
    this.viewMode = 'third'; this.firstPersonAnchor = 0; this.localAimYaw = null;
    this.clock = 0; this.quality = 'medium'; this.reducedMotion = false; this.zoom = 1; this.playing = false; this.self = null; this.state = null;
    this.actors = new Map(); this.vehicles = new Map(); this.pickups = new Map(); this.effects = []; this.buildings = []; this.streetLights = []; this.lastPower = -1; this.lastStage = -1; this.shake = 0;
    this.raycaster = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1); this.aimPoint = new THREE.Vector3(); this.temp = new THREE.Vector3();
    this.nightSky = new THREE.Color(0x0d1b23); this.daySky = new THREE.Color(0x8baab0); this.nightFog = new THREE.Color(0x10242a); this.dayFog = new THREE.Color(0x9bb3aa); this.daylight = 0;
    this.hemisphere = new THREE.HemisphereLight(0xa3c8d6, 0x26332c, 1.8); this.scene.add(this.hemisphere);
    this.moon = new THREE.DirectionalLight(0xb9d7e8, 2.2); this.moon.position.set(-35, 70, 15); this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048); this.moon.shadow.camera.left = -55; this.moon.shadow.camera.right = 55; this.moon.shadow.camera.top = 55; this.moon.shadow.camera.bottom = -55; this.moon.shadow.camera.far = 160; this.moon.shadow.normalBias = 0.04; this.moon.shadow.bias = -0.0001;
    this.sun = new THREE.DirectionalLight(0xffdbab, 0); this.sun.position.set(-28, 48, -32); this.scene.add(this.moon, this.moon.target, this.sun);
    this.buildCity(); this.buildStation(); this.buildAtmosphere();
    this.flashlight = new THREE.SpotLight(0xe9dfb5, 0, 32, Math.PI / 5.5, 0.65, 1.3); this.scene.add(this.flashlight, this.flashlight.target);
    this.muzzleLight = new THREE.PointLight(0xffc477, 0, 10, 2); this.scene.add(this.muzzleLight);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.33, 0.5, 1.1); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.resize();
  }
  buildCity() {
    const rng = randomSeed(51817);
    const staticGroup = new THREE.Group(); this.scene.add(staticGroup);
    const groundTexture = textureCanvas(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#4a5150'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 28000; i++) { const v = 35 + rng() * 55; ctx.fillStyle = `rgba(${v},${v + 4},${v + 2},.3)`; ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2); }
      ctx.strokeStyle = '#252d2b'; ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) { let x = rng() * w, y = rng() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (rng() - 0.5) * 40; y += rng() * 25; ctx.lineTo(x, y); } ctx.stroke(); }
    });
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping; groundTexture.repeat.set(24, 24);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x59665f, map: groundTexture, roughness: 0.36, metalness: 0.3 });
    box(staticGroup, 0, -0.18, 0, 260, 0.3, 260, groundMat);
    const road = material(0x263437, 0.31, 0.4);
    for (const x of [-23, 0, 23]) box(staticGroup, x, -0.01, 0, x === 0 ? 23 : 8, 0.05, 178, road);
    for (const z of [-80, -52, -24, 4, 32, 60]) box(staticGroup, 0, 0.005, z, 178, 0.05, 8, road);
    const marking = material(0x9b9a78, 0.65);
    for (let z = -82; z < 84; z += 7) { box(staticGroup, -1.1, 0.026, z, 0.14, 0.02, 3.5, marking); box(staticGroup, 1.1, 0.026, z, 0.14, 0.02, 3.5, marking); }
    for (const z of [-24, 32, 60]) for (let x = -9; x <= 9; x += 2.5) box(staticGroup, x, 0.035, z - 5, 1.2, 0.02, 3, material(0x9ba69a));
    const facadeMaps = Array.from({ length: 4 }, (_, variant) => textureCanvas(256, 512, (ctx, w, h) => {
      ctx.fillStyle = ['#64736b', '#667075', '#726e60', '#626b63'][variant]; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 7000; i++) { ctx.fillStyle = rng() > 0.5 ? '#0000000c' : '#cbd3c50e'; ctx.fillRect(rng() * w, rng() * h, 1, 5 + rng() * 35); }
      for (let y = 22; y < h; y += 65) {
        ctx.fillStyle = '#232f2d'; ctx.fillRect(0, y + 45, w, 3);
        for (let x = 14; x < w; x += 49) {
          ctx.fillStyle = '#36413d'; ctx.fillRect(x - 3, y - 3, 32, 41);
          ctx.fillStyle = rng() > 0.2 ? '#17272c' : '#344140'; ctx.fillRect(x, y, 26, 34);
          ctx.fillStyle = '#6b777144'; ctx.fillRect(x, y + 16, 26, 2); ctx.fillRect(x + 12, y, 2, 34);
          if (rng() > 0.68) { ctx.strokeStyle = '#86918b44'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y + 22); ctx.lineTo(x + 5, y + 31); ctx.stroke(); }
        }
      }
    }));
    const signs = ['HARBOR', 'PHARMACY', 'ORION', 'NORTHLINE', 'REPAIR', 'MARKET'];
    for (const b of WORLD.buildings) {
      const group = new THREE.Group(); this.scene.add(group);
      const facade = new THREE.MeshStandardMaterial({ map: facadeMaps[b.variant], color: 0xa2aea4, roughness: 0.85, transparent: true });
      const roof = new THREE.MeshStandardMaterial({ color: 0x45534d, roughness: 0.92, transparent: true });
      const body = new THREE.Mesh(boxGeo, [facade, facade, roof, roof, facade, facade]); body.position.set(b.x, b.h / 2, b.z); body.scale.set(b.w, b.h, b.d); body.castShadow = true; body.receiveShadow = true; group.add(body);
      const roofMat = roof;
      box(group, b.x, b.h + 0.18, b.z, b.w + 0.4, 0.36, b.d + 0.4, roofMat);
      box(group, b.x - b.w / 2, b.h + 0.75, b.z, 0.25, 1.4, b.d, roofMat);
      box(group, b.x + b.w / 2, b.h + 0.75, b.z, 0.25, 1.4, b.d, roofMat);
      box(group, b.x, b.h + 0.75, b.z - b.d / 2, b.w, 1.4, 0.25, roofMat);
      box(group, b.x, b.h + 0.75, b.z + b.d / 2, b.w, 1.4, 0.25, roofMat);
      box(group, b.x - 3, b.h + 0.7, b.z, 3, 1.2, 2.6, roofMat);
      if (b.id % 3 === 0) { cylinder(group, b.x + 3, b.h + 1.8, b.z - 2, 1.8, 3.5, roofMat); cylinder(group, b.x + 3, b.h + 4, b.z - 2, 0.12, 2, roofMat); }
      if (b.id % 2 === 0) {
        const mat = new THREE.MeshStandardMaterial({ map: signTexture(signs[b.id % signs.length], 'CLOSED UNTIL FURTHER NOTICE'), roughness: 0.8, transparent: true });
        box(group, b.x, 3.7, b.z + b.d / 2 + 0.12, b.w * 0.78, 1.8, 0.16, mat);
      }
      box(staticGroup, b.x, 0.12, b.z, b.w + 2.5, 0.25, b.d + 2.5, material(0x586660, 0.7));
      box(group, b.x, 1.1, b.z + b.d / 2 + 0.15, 2.3, 2.2, 0.2, roofMat);
      batch(group);
      this.buildings.push({ group, data: b, opacity: 1, materials: new Set() });
      group.traverse(obj => { if (obj.isMesh) { for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) this.buildings[this.buildings.length - 1].materials.add(m); } });
    }
    for (let i = 0; i < 45; i++) {
      const a = rng() * Math.PI * 2, r = 108 + rng() * 35;
      box(staticGroup, Math.sin(a) * r, 12 + rng() * 13, Math.cos(a) * r, 10 + rng() * 12, 24 + rng() * 26, 10 + rng() * 15, material(0x263a3f));
    }
    for (const x of [-13, 13]) for (let z = -70; z < 80; z += 22) {
      cylinder(staticGroup, x, 3.5, z, 0.1, 7, material(0x384d48, 0.6, 0.6));
      box(staticGroup, x + (x < 0 ? 1 : -1), 7, z, 2, 0.15, 0.2, material(0x384d48));
      const bulb = box(this.scene, x + (x < 0 ? 2 : -2), 6.85, z, 0.8, 0.08, 0.4, emissive(0xffd39a, 0));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 7, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xebc99a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); cone.position.set(bulb.position.x, 3.5, z); this.scene.add(cone);
      this.streetLights.push({ bulb, cone });
    }
    for (let i = 0; i < 65; i++) {
      const x = (rng() - 0.5) * 165, z = (rng() - 0.5) * 170;
      if (blocked(x, z, 2) || Math.hypot(x, z) < 9) continue;
      if (i % 4 === 0) {
        const trunk = cylinder(staticGroup, x, 2.1, z, 0.18, 4.2, material(0x4b4940)); trunk.rotation.z = (rng() - 0.5) * 0.3;
        for (let j = 0; j < 3; j++) { const branch = cylinder(staticGroup, x, 2.7 + j * 0.5, z, 0.08, 1.8, material(0x4b4940)); branch.rotation.z = (j % 2 ? 1 : -1) * 0.8; }
      } else if (i % 4 === 1) { box(staticGroup, x, 0.6, z, 1.6, 1.2, 1.2, material(0x71654b)); box(staticGroup, x, 0.64, z, 1.65, 0.12, 1.25, material(0x3d4943)); }
      else if (i % 4 === 2) { cylinder(staticGroup, x, 0.58, z, 0.44, 1.15, material(0x604f3e, 0.8, 0.5)); }
      else { for (let j = 0; j < 3; j++) box(staticGroup, x + rng(), 0.2, z + rng(), 0.5 + rng(), 0.35, 0.5, material(0x777c6b), rng() * 3); }
    }
    for (const [x, z] of [[-8, 43], [8, -45], [-18, -8], [17, 68]]) {
      box(staticGroup, x, 0.55, z, 4, 1.1, 0.65, material(0x737662));
      for (let j = -1; j <= 1; j++) box(staticGroup, x + j * 1.1, 0.85, z + 0.34, 0.5, 0.25, 0.025, material(0xd3a658));
    }
    for (let i = 0; i < 28; i++) {
      const x = (rng() - 0.5) * 160, z = (rng() - 0.5) * 160;
      if (blocked(x, z)) continue;
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 14), new THREE.MeshStandardMaterial({ color: 0x547477, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.58 }));
      puddle.rotation.x = -Math.PI / 2; puddle.rotation.z = rng() * 4; puddle.scale.set(1 + rng() * 3, 0.5 + rng() * 1.2, 1); puddle.position.set(x, 0.05, z); this.scene.add(puddle);
    }
    groundLabel(this.scene, 'KEEP CLEAR', 0, 13, 11);
    groundLabel(this.scene, 'EVACUATION', 0, 68, 14, '#a4b990');
    groundLabel(this.scene, 'SECTOR 07', 0, -35, 16);
    batch(staticGroup);
    for (const car of WORLD.cars) { const group = this.createVehicle(car); this.scene.add(group); this.vehicles.set(car.id, group); }
    for (const supply of WORLD.supplies) this.addPickup(supply);
  }
  buildStation() {
    const group = new THREE.Group(); this.scene.add(group);
    box(group, 0, 0.2, 0, 13, 0.4, 10, material(0x68766b));
    box(group, 0, 0.43, 0, 12, 0.1, 9, material(0x394c46));
    const metal = material(0x455957, 0.5, 0.65);
    for (const x of [-3.5, 3.5]) {
      box(group, x, 1.4, -1, 2.8, 2, 3, metal);
      for (let z = -2; z <= 0; z += 0.6) box(group, x, 2.55, z, 2.3, 0.25, 0.12, material(0x8b967f, 0.4, 0.7));
      for (const dx of [-0.65, 0.65]) { cylinder(group, x + dx, 3.15, -1, 0.16, 1.2, metal); for (let j = 0; j < 4; j++) cylinder(group, x + dx, 2.85 + j * 0.2, -1, 0.3, 0.1, material(0x9d9279)); }
    }
    box(group, 0, 1.3, 1.8, 2, 1.9, 1.2, material(0x667366));
    box(group, 0, 1.8, 2.42, 1.2, 0.5, 0.04, emissive(0x75b8a7, 0.5));
    this.cellSlots = [];
    for (let i = 0; i < 5; i++) this.cellSlots.push(box(this.scene, -1.2 + i * 0.6, 0.62, 4, 0.35, 0.18, 0.7, emissive(C.amber, 0.08)));
    for (const x of [-5.5, 5.5]) { cylinder(group, x, 5.5, -3.5, 0.12, 10, metal); box(group, x, 8.8, -3.5, 2.6, 0.1, 0.18, metal); }
    const cableCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-5.5, 9, -3.5), new THREE.Vector3(0, 7, -3.5), new THREE.Vector3(5.5, 9, -3.5)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 16, 0.03, 4, false), material(0x182421)); group.add(cable);
    const sign = box(group, 0, 5.4, -4, 8.5, 2.1, 0.18, new THREE.MeshStandardMaterial({ map: signTexture('BLACKGRID', 'MUNICIPAL POWER / SECTOR 07', '#d4c9a4'), roughness: 0.8 }));
    cylinder(group, -4, 2.8, -4, 0.08, 5.4, metal); cylinder(group, 4, 2.8, -4, 0.08, 5.4, metal);
    this.stationLight = new THREE.PointLight(0xffc781, 6, 30, 1.5); this.stationLight.position.set(0, 5, 0); this.scene.add(this.stationLight);
    this.stationRing = new THREE.Mesh(new THREE.RingGeometry(16.7, 17, 96), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.24, side: THREE.DoubleSide })); this.stationRing.rotation.x = -Math.PI / 2; this.stationRing.position.y = 0.08; this.scene.add(this.stationRing);
    this.stationBeacon = this.beacon(0, 0, C.amber, 18); this.scene.add(this.stationBeacon);
    this.extractionBeacon = this.beacon(EXTRACTION.x, EXTRACTION.z, 0xaed7ae, 22); this.extractionBeacon.visible = false; this.scene.add(this.extractionBeacon);
    const evacRing = new THREE.Mesh(new THREE.RingGeometry(6, 6.2, 64), new THREE.MeshBasicMaterial({ color: 0x86a582, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); evacRing.rotation.x = -Math.PI / 2; evacRing.position.set(0, 0.1, 76); this.scene.add(evacRing);
    batch(group);
  }
  beacon(x, z, color, height) {
    const group = new THREE.Group(); group.position.set(x, 0, z);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1, height, 12, 1, true), mat); cone.position.y = height / 2; group.add(cone);
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color })); top.position.y = 4; group.add(top);
    return group;
  }
  buildAtmosphere() {
    const rng = randomSeed(4561);
    const positions = new Float32Array(1600 * 3);
    for (let i = 0; i < positions.length; i += 3) { positions[i] = (rng() - 0.5) * 90; positions[i + 1] = rng() * 35; positions[i + 2] = (rng() - 0.5) * 90; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x91afb5, size: 0.075, transparent: true, opacity: 0.42, depthWrite: false })); this.rain.frustumCulled = false; this.scene.add(this.rain);
    const skyGeo = new THREE.BufferGeometry(); const stars = new Float32Array(180 * 3);
    for (let i = 0; i < stars.length; i += 3) { stars[i] = (rng() - 0.5) * 250; stars[i + 1] = 90 + rng() * 60; stars[i + 2] = (rng() - 0.5) * 250; }
    skyGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3)); this.scene.add(new THREE.Points(skyGeo, new THREE.PointsMaterial({ color: 0x91bac9, size: 0.22, transparent: true, opacity: 0.4 })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xb1c8cd, fog: false })); moon.position.set(-70, 100, -130); this.scene.add(moon);
  }
  createVehicle(data) {
    const group = new THREE.Group(); group.position.set(data.x, 0, data.z); group.rotation.y = data.yaw;
    const paint = material(data.color, 0.4, 0.55), dark = material(0x17201e, 0.6), glass = material(0x344b50, 0.1, 0.8);
    box(group, 0, 0.65, 0, 1.9, 0.65, 4, paint);
    box(group, 0, 1.25, -0.35, 1.7, 0.85, 2, paint);
    box(group, 0, 1.3, 0.67, 1.55, 0.6, 0.06, glass, 0);
    box(group, 0, 1.3, -1.38, 1.5, 0.6, 0.06, glass);
    for (const x of [-0.87, 0.87]) { box(group, x, 1.3, -0.3, 0.04, 0.6, 1.75, glass); box(group, x, 1.3, -0.3, 0.05, 0.7, 0.08, paint); box(group, x * 1.16, 1.1, 0.5, 0.3, 0.15, 0.3, paint); }
    box(group, 0, 0.5, 2.04, 1.95, 0.25, 0.15, material(0x858678, 0.3, 0.8));
    box(group, 0, 0.5, -2.04, 1.95, 0.2, 0.15, dark);
    const lamps = [], wheels = [];
    for (const x of [-0.67, 0.67]) {
      lamps.push(box(group, x, 0.88, 2.02, 0.44, 0.22, 0.08, emissive(0xffdd9c, 0.12)));
      box(group, x, 0.88, -2.02, 0.38, 0.19, 0.08, emissive(0xad493a, 0.2));
    }
    for (const x of [-0.98, 0.98]) for (const z of [-1.3, 1.3]) {
      const wheel = cylinder(group, x, 0.45, z, 0.46, 0.3, dark); wheel.rotation.z = Math.PI / 2; wheels.push(wheel);
      const hub = cylinder(group, x * 1.14, 0.45, z, 0.23, 0.035, material(0x717e76, 0.4, 0.6)); hub.rotation.z = Math.PI / 2;
    }
    for (const x of [-0.6, 0.6]) box(group, x, 1.8, -0.25, 0.08, 0.12, 2.2, dark);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.2, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xf4d29c, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide })); beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.8, 9); beam.visible = false; group.add(beam);
    group.remove(...lamps, beam);
    batch(group);
    group.add(...lamps, beam);
    group.userData = { lamps, wheels: [], beam, data };
    return group;
  }
  createActor(data, zombie = false, mine = false) {
    const group = new THREE.Group(); const infected = zombie || data.infected;
    const skin = material(infected ? [0x84917b, 0x92927e, 0x758978][data.variant || 0] : 0xb69a7c);
    const cloth = material(infected ? [0x555c4b, 0x65574b, 0x4f6260][data.variant || 0] : mine ? 0xb6a47c : 0x657e73);
    const pants = material(infected ? 0x303c35 : 0x364844);
    const torso = box(group, 0, 1.12, 0, 0.61, 0.7, 0.36, cloth); torso.rotation.x = infected ? 0.15 : 0;
    sphere(group, 0, 1.77, 0.05, 0.22, skin);
    if (!infected) {
      box(group, 0, 1.83, 0, 0.45, 0.16, 0.45, material(mine ? 0x8e8b6e : 0x475e55));
      box(group, 0, 1.15, -0.25, 0.48, 0.6, 0.2, material(0x35483b));
      box(group, 0, 1.28, 0.21, 0.45, 0.28, 0.1, material(0x465546));
      box(group, -0.22, 1.32, 0.27, 0.09, 0.13, 0.035, emissive(mine ? C.amber : C.cyan, 0.7));
    } else { box(group, 0, 1.74, 0.25, 0.23, 0.045, 0.025, emissive(0xcd7e55, 0.55)); box(group, 0.17, 1.15, 0.2, 0.17, 0.23, 0.02, material(0x654e3f)); }
    const limbs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * 0.18, 0.84, 0); group.add(leg);
      box(leg, 0, -0.31, 0, 0.22, 0.63, 0.24, pants); box(leg, 0, -0.63, 0.08, 0.25, 0.18, 0.38, material(0x24322c)); limbs.push(leg);
      const arm = new THREE.Group(); arm.position.set(side * 0.4, 1.4, 0); arm.rotation.x = infected ? -0.8 : -0.65; group.add(arm);
      box(arm, 0, -0.22, 0, 0.17, 0.42, 0.19, cloth); sphere(arm, 0, -0.47, 0, 0.11, skin); limbs.push(arm);
    }
    const gun = new THREE.Group(); gun.position.set(0.32, 1.07, 0.45); group.add(gun);
    box(gun, 0, 0, 0.13, 0.12, 0.15, 0.5, material(0x1b2928, 0.5, 0.65)); box(gun, 0, -0.12, 0, 0.1, 0.2, 0.14, material(0x293a33)); gun.visible = !infected;
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), new THREE.MeshBasicMaterial({ color: 0xffd68c })); flash.rotation.x = Math.PI / 2; flash.position.set(0.32, 1.08, 1.05); flash.visible = false; group.add(flash);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.57, 0.64, 24), new THREE.MeshBasicMaterial({ color: infected ? 0xae6d51 : mine ? C.amber : C.cyan, transparent: true, opacity: mine ? 0.7 : 0.25, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; group.add(ring);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x07100e, transparent: true, opacity: 0.4, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; group.add(shadow);
    let nameTag = null;
    if (!zombie && !data.bot) {
      const map = textureCanvas(512, 112, (ctx, w, h) => {
        ctx.fillStyle = mine ? 'rgba(31,25,17,.88)' : 'rgba(7,20,22,.9)'; ctx.fillRect(4, 8, w - 8, h - 16);
        ctx.strokeStyle = mine ? '#eac477' : '#87c7be'; ctx.lineWidth = 4; ctx.strokeRect(4, 8, w - 8, h - 16);
        const name = String(data.name || 'PLAYER').slice(0, 16).toUpperCase();
        ctx.font = '700 48px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2f0e7'; ctx.shadowColor = '#000'; ctx.shadowBlur = 8; ctx.fillText(name, w / 2, h / 2 + 1, w - 42);
      });
      nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
      nameTag.position.set(0, 2.75, 0); nameTag.scale.set(3.5, 0.77, 1); nameTag.renderOrder = 20; group.add(nameTag);
    }
    group.position.set(data.x, 0, data.z); group.rotation.y = data.yaw;
    if (zombie) group.traverse(obj => { if (obj.isMesh) obj.castShadow = false; });
    group.userData = { limbs, torso, gun, flash, ring, nameTag, infected, mine, zombie, data, flashUntil: 0, previousX: data.x, previousZ: data.z, walk: 0 };
    return group;
  }
  addPickup(data) {
    const group = new THREE.Group(); group.position.set(data.x, 0, data.z);
    const color = data.type === 'battery' ? C.amber : data.type === 'medkit' ? 0x9fc7ad : C.cyan;
    const body = new THREE.Group(); body.position.y = 0.65; group.add(body);
    if (data.type === 'battery') {
      box(body, 0, 0, 0, 0.5, 0.75, 0.32, material(0x86785b, 0.4, 0.6)); box(body, 0, 0, 0.18, 0.22, 0.47, 0.03, emissive(color, 1.3)); box(body, 0, 0.44, 0, 0.24, 0.12, 0.18, material(0x9fa490));
      const beacon = this.beacon(0, 0, color, 6); beacon.children[1].position.y = 2.4; beacon.children[1].scale.setScalar(0.5); group.add(beacon);
    } else if (data.type === 'medkit') { box(body, 0, 0, 0, 0.55, 0.35, 0.45, material(0x98a78a)); box(body, 0, 0.2, 0, 0.3, 0.03, 0.1, emissive(color, 0.5)); box(body, 0, 0.2, 0, 0.1, 0.03, 0.3, emissive(color, 0.5)); }
    else if (data.type === 'ammo') { box(body, 0, 0, 0, 0.65, 0.38, 0.4, material(0x63785b)); box(body, 0, 0.22, 0, 0.4, 0.06, 0.25, emissive(color, 0.4)); }
    else { box(body, 0, 0, 0, 0.17, 0.2, 1.1, material(0x53625c)); box(body, 0, -0.18, 0, 0.14, 0.3, 0.2, material(0x53625c)); box(body, 0, 0.14, 0.2, 0.07, 0.04, 0.4, emissive(color, 0.8)); body.rotation.z = Math.PI / 3; }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.72, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; group.add(ring);
    group.userData = { body, data }; this.scene.add(group); this.pickups.set(data.id, group);
  }
  applyState(state, id) {
    this.state = state; this.self = id; this.playing = true;
    const actorIds = new Set();
    const viewerInfected = state.players.find(p => p.id === id)?.infected;
    for (const [list, zombie] of [[state.players, false], [state.zombies, true]]) for (const data of list) {
      actorIds.add(data.id);
      let actor = this.actors.get(data.id);
      if (actor && actor.userData.infected !== Boolean(zombie || data.infected)) { disposeGroup(actor); this.actors.delete(data.id); actor = null; }
      if (!actor) { actor = this.createActor(data, zombie, data.id === id); this.scene.add(actor); this.actors.set(data.id, actor); }
      actor.userData.data = data;
      actor.visible = !data.dead && !data.vehicle && (!viewerInfected || zombie || data.infected || isIlluminated(state, data));
    }
    for (const [key, actor] of this.actors) if (!actorIds.has(key)) { disposeGroup(actor); this.actors.delete(key); }
    for (const car of state.cars) { const actor = this.vehicles.get(car.id); if (actor) actor.userData.data = car; }
    const supplyIds = new Set(state.supplies.map(s => s.id));
    for (const [key, item] of this.pickups) if (!supplyIds.has(key)) { disposeGroup(item); this.pickups.delete(key); }
    for (const s of state.supplies) if (!this.pickups.has(s.id)) this.addPickup(s);
    if (this.lastPower !== state.power || this.lastStage !== state.stage) {
      const powered = state.power >= state.required;
      this.stationLight.intensity = state.power ? 32 + state.power * 8 : 6;
      this.stationRing.material.color.setHex(powered ? C.green : C.amber);
      this.extractionBeacon.visible = powered; this.stationBeacon.visible = !powered;
      for (let i = 0; i < this.cellSlots.length; i++) { this.cellSlots[i].visible = i < state.required; this.cellSlots[i].material.emissiveIntensity = i < state.power ? 3 : 0.08; }
      for (const light of this.streetLights) { light.bulb.material.emissiveIntensity = powered ? 2.5 : 0; light.cone.material.opacity = powered ? 0.035 : 0; }
      this.lastPower = state.power; this.lastStage = state.stage;
    }
  }
  effect(event) {
    if (event.type === 'shot') {
      const actor = this.actors.get(event.player); if (actor) actor.userData.flashUntil = this.clock + 0.06;
      const points = [new THREE.Vector3(event.x, 1.15, event.z), new THREE.Vector3(event.ex, 0.95, event.ez)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xf3cc87, transparent: true, opacity: 0.85 })); this.scene.add(line); this.effects.push({ mesh: line, life: 0.07, max: 0.07 });
      if (event.player === this.self) { this.muzzleLight.position.set(event.x, 2, event.z); this.muzzleLight.intensity = 16; this.shake = 0.13; }
    }
    if (['impact', 'kill', 'power'].includes(event.type)) {
      const count = event.type === 'power' ? 16 : 7;
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: event.type === 'power' ? C.amber : 0x9b704d, transparent: true })); mesh.position.set(event.x, event.type === 'power' ? 2 : 1, event.z); this.scene.add(mesh); this.effects.push({ mesh, life: 0.4 + Math.random() * 0.4, max: 0.8, velocity: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4) });
      }
    }
    if (event.type === 'hit' && event.player === this.self) this.shake = 0.35;
  }
  aim(clientX, clientY) {
    const actor = this.actors.get(this.self);
    if (this.viewMode === 'first') {
      const horizontalFov = 2 * Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect);
      const offset = (clientX / Math.max(1, this.canvas.clientWidth) - 0.5) * horizontalFov;
      this.localAimYaw = this.firstPersonAnchor + offset;
      return this.localAimYaw;
    }
    this.mouse.set(clientX / this.canvas.clientWidth * 2 - 1, -(clientY / this.canvas.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint);
    return actor ? Math.atan2(this.aimPoint.x - actor.position.x, this.aimPoint.z - actor.position.z) : 0;
  }
  setView(mode) {
    this.viewMode = mode === 'first' ? 'first' : 'third';
    const actor = this.actors.get(this.self);
    if (this.viewMode === 'first' && actor) {
      this.firstPersonAnchor = actor.userData.data.yaw;
      this.localAimYaw = this.firstPersonAnchor;
      this.camera.position.set(actor.position.x, actor.userData.data.vehicle ? 2.05 : 1.58, actor.position.z);
      this.camera.lookAt(actor.position.x + Math.sin(this.firstPersonAnchor) * 12, 1.4, actor.position.z + Math.cos(this.firstPersonAnchor) * 12);
    }
    if (actor) actor.visible = this.viewMode !== 'first';
    return this.viewMode;
  }
  setQuality(quality) {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.25 : quality === 'medium' ? 1 : 0.8));
    this.scene.fog.density = quality === 'low' ? 0.012 : 0.009;
    this.rain.geometry.setDrawRange(0, quality === 'high' ? 1200 : quality === 'medium' ? 650 : 180);
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false); this.composer?.setSize(w, h);
  }
  update(dt) {
    this.clock += dt;
    const dayTarget = this.state?.phase === 'hub' ? 1 : 0;
    this.daylight += (dayTarget - this.daylight) * (1 - Math.exp(-dt * 1.4));
    this.scene.background.lerpColors(this.nightSky, this.daySky, this.daylight);
    this.scene.fog.color.lerpColors(this.nightFog, this.dayFog, this.daylight);
    this.scene.fog.density = 0.009 - this.daylight * 0.0055;
    this.hemisphere.intensity = 1.8 + this.daylight * 1.1; this.moon.intensity = 2.2 - this.daylight * 2;
    this.sun.intensity = this.daylight * 2.2;
    const player = this.actors.get(this.self);
    const smooth = 1 - Math.exp(-dt * 15);
    for (const actor of this.actors.values()) {
      const u = actor.userData, d = u.data;
      const beforeX = actor.position.x, beforeZ = actor.position.z;
      if (Math.hypot(d.x - actor.position.x, d.z - actor.position.z) > 10) actor.position.set(d.x, 0, d.z);
      else { actor.position.x += (d.x - actor.position.x) * smooth; actor.position.z += (d.z - actor.position.z) * smooth; }
      const delta = Math.atan2(Math.sin(d.yaw - actor.rotation.y), Math.cos(d.yaw - actor.rotation.y)); actor.rotation.y += delta * smooth;
      const speed = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ) / Math.max(dt, 0.001);
      u.walk += speed * dt * 2.7;
      const stride = Math.min(speed / 4, 1) * 0.6;
      u.limbs[0].rotation.x = Math.sin(u.walk) * stride; u.limbs[2].rotation.x = -Math.sin(u.walk) * stride;
      if (u.infected) { u.limbs[1].rotation.x = -0.95 + Math.sin(u.walk) * 0.2; u.limbs[3].rotation.x = -0.7 - Math.sin(u.walk) * 0.2; }
      u.torso.position.y = 1.12 + Math.abs(Math.sin(u.walk)) * stride * 0.04;
      u.flash.visible = this.clock < u.flashUntil; u.ring.material.opacity = u.mine ? 0.45 + Math.sin(this.clock * 3) * 0.1 : 0.22;
    }
    for (const car of this.vehicles.values()) {
      const d = car.userData.data;
      car.position.x += (d.x - car.position.x) * smooth; car.position.z += (d.z - car.position.z) * smooth;
      car.rotation.y += Math.atan2(Math.sin(d.yaw - car.rotation.y), Math.cos(d.yaw - car.rotation.y)) * smooth;
      for (const lamp of car.userData.lamps) lamp.material.emissiveIntensity = d.headlights ? 3 : 0.12;
      car.userData.beam.visible = Boolean(d.headlights);
      for (const wheel of car.userData.wheels) wheel.rotation.x += (d.speed || 0) * dt * 2;
    }
    if (this.playing && player) {
      const data = player.userData.data;
      const target = player.position.clone(); target.y = 0;
      if (this.viewMode === 'first') {
        const yaw = this.localAimYaw ?? data.yaw;
        this.camera.position.set(target.x, data.vehicle ? 2.05 : 1.58, target.z);
        this.camera.lookAt(target.x + Math.sin(yaw) * 12, data.vehicle ? 1.8 : 1.4, target.z + Math.cos(yaw) * 12);
      } else {
        const height = data.vehicle ? 30 : 23;
        const offset = new THREE.Vector3(0, height * this.zoom, 21 * this.zoom);
        this.temp.copy(target).add(offset);
        this.camera.position.lerp(this.temp, 1 - Math.exp(-dt * 5));
        this.camera.lookAt(target.x, 0, target.z - 3);
      }
      if (this.shake > 0.005 && !this.reducedMotion) { this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; }
      this.moon.position.set(target.x - 35, 70, target.z + 15); this.moon.target.position.copy(target);
      this.flashlight.position.set(target.x, 1.6, target.z); this.flashlight.target.position.set(target.x + Math.sin(data.yaw) * 15, 0, target.z + Math.cos(data.yaw) * 15); this.flashlight.intensity = data.light && !data.infected && !data.dead ? 75 : data.vehicle ? 100 : 0;
      this.rain.position.set(target.x, 0, target.z);
      for (const building of this.buildings) {
        const b = building.data;
        const occluding = Math.abs(b.x - target.x) < b.w / 2 + 3 && b.z > target.z - 2 && b.z < target.z + 24;
        building.opacity += ((occluding ? 0.17 : 1) - building.opacity) * Math.min(1, dt * 7);
        for (const mat of building.materials) { mat.opacity = building.opacity; mat.depthWrite = building.opacity > 0.9; }
      }
    } else {
      const t = this.clock * 0.035;
      this.camera.position.set(32 + Math.sin(t) * 7, 24, 41 + Math.cos(t) * 5); this.camera.lookAt(-3, 1.5, -12);
      this.flashlight.intensity = 0;
    }
    for (const item of this.pickups.values()) { item.userData.body.position.y = 0.67 + Math.sin(this.clock * 2 + item.position.x) * 0.12; item.userData.body.rotation.y += dt * 0.45; }
    this.stationBeacon.children[1].rotation.y += dt; this.extractionBeacon.children[1].rotation.y += dt;
    this.stationRing.material.opacity = 0.4 + Math.sin(this.clock * 2) * 0.13;
    this.shake *= Math.exp(-dt * 14); this.muzzleLight.intensity *= Math.exp(-dt * 40);
    this.rain.visible = !this.reducedMotion && this.daylight < 0.99;
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { p[i] -= dt * 1.3; p[i + 1] -= dt * 20; if (p[i + 1] < 0) p[i + 1] = 35; if (p[i] < -45) p[i] = 45; }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.life -= dt;
      if (e.life <= 0) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); this.effects.splice(i, 1); continue; }
      e.mesh.material.opacity = e.life / e.max;
      if (e.velocity) { e.velocity.y -= dt * 8; e.mesh.position.addScaledVector(e.velocity, dt); }
    }
    if (this.clock >= this.shadowAt) { this.renderer.shadowMap.needsUpdate = true; this.shadowAt = this.clock + (this.quality === 'high' ? 0.3 : 0.5); }
    if (this.quality === 'high') this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }
  reset() {
    for (const actor of this.actors.values()) disposeGroup(actor);
    this.actors.clear(); this.playing = false; this.self = null; this.state = null; this.viewMode = 'third';
    for (const b of this.buildings) { b.opacity = 1; for (const m of b.materials) { m.opacity = 1; m.depthWrite = true; } }
    this.lastPower = -1; this.stationLight.intensity = 6; this.stationBeacon.visible = true; this.extractionBeacon.visible = false;
    for (const light of this.streetLights) { light.bulb.material.emissiveIntensity = 0; light.cone.material.opacity = 0; }
    for (const car of WORLD.cars) this.vehicles.get(car.id).userData.data = car;
    for (const supply of WORLD.supplies) if (!this.pickups.has(supply.id)) this.addPickup(supply);
  }
}
