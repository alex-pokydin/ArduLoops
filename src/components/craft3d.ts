import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type CraftVehicle = "plane" | "copter";
export type CraftViewCam = "rear" | "side" | "top" | "iso";

export type CraftPose = {
  roll: number;
  pitch: number;
  yaw: number;
};

const CYAN = 0x4fc3f7;
const AMBER = 0xffb74d;
const BODY = 0x1a1e24;
const IDLE_BODY = 0x3a414a;
const GREY = 0x6b7884;
const GHOST = 0xd7e3ea;
const DEG = Math.PI / 180;

function addPart(
  root: Group,
  geom: BufferGeometry,
  fill: Material,
  edge: Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  threshold = 1,
) {
  const wrap = new Group();
  wrap.position.set(x, y, z);
  wrap.rotation.set(rx, ry, rz);
  wrap.add(new Mesh(geom, fill));
  wrap.add(new LineSegments(new EdgesGeometry(geom, threshold), edge));
  root.add(wrap);
}

function buildPlane(fill: Material, edge: Material): Group {
  const g = new Group();
  addPart(g, new BoxGeometry(0.16, 0.14, 1.02), fill, edge, 0, 0, 0.04);
  addPart(g, new ConeGeometry(0.08, 0.28, 6), fill, edge, 0, 0, -0.58, -Math.PI / 2, 0, 0, 35);
  addPart(g, new BoxGeometry(1.72, 0.03, 0.32), fill, edge, 0, 0.01, -0.04);
  addPart(g, new BoxGeometry(0.5, 0.02, 0.16), fill, edge, 0, 0.02, 0.48);
  addPart(g, new BoxGeometry(0.025, 0.28, 0.2), fill, edge, 0, 0.16, 0.46);
  return g;
}

function buildCopter(fill: Material, edge: Material): Group {
  const g = new Group();
  addPart(g, new BoxGeometry(0.32, 0.1, 0.36), fill, edge, 0, 0, 0);
  addPart(g, new ConeGeometry(0.07, 0.16, 6), fill, edge, 0, 0, -0.24, -Math.PI / 2, 0, 0, 35);
  addPart(g, new BoxGeometry(1.12, 0.035, 0.045), fill, edge, 0, 0, 0, 0, Math.PI / 4);
  addPart(g, new BoxGeometry(1.12, 0.035, 0.045), fill, edge, 0, 0, 0, 0, -Math.PI / 4);
  const span = 0.4;
  for (const [x, z] of [
    [-span, -span],
    [span, -span],
    [-span, span],
    [span, span],
  ] as const) {
    addPart(g, new CylinderGeometry(0.18, 0.18, 0.012, 16), fill, edge, x, 0.06, z, 0, 0, 0, 40);
  }
  return g;
}

function buildVehicle(vehicle: CraftVehicle, fill: Material, edge: Material): Group {
  return vehicle === "plane" ? buildPlane(fill, edge) : buildCopter(fill, edge);
}

function makeFill(hex: number, opacity: number): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function makeEdge(hex: number, opacity: number): LineBasicMaterial {
  return new LineBasicMaterial({
    color: hex,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
  });
}

function disposeTree(obj: Object3D) {
  obj.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
    }
  });
}

function applyAtt(obj: Group, pose: CraftPose, cam: CraftViewCam) {
  obj.rotation.order = "YXZ";
  obj.rotation.x = pose.pitch * DEG;
  obj.rotation.z = -pose.roll * DEG;
  obj.rotation.y = cam === "top" ? -pose.yaw * DEG : 0;
}

function snapCam(camera: PerspectiveCamera, controls: OrbitControls, cam: CraftViewCam) {
  const d = 2.55;
  camera.up.set(0, 1, 0);
  controls.target.set(0, 0, 0);
  if (cam === "rear") camera.position.set(0, 0.32, d);
  else if (cam === "side") camera.position.set(d, 0.08, 0);
  else if (cam === "top") camera.position.set(0, d, 0.0001);
  else camera.position.set(d * 0.7, d * 0.46, d * 0.84);
  controls.update();
}

function lookingDown(camera: PerspectiveCamera, controls: OrbitControls): boolean {
  const y = camera.position.y - controls.target.y;
  const dx = camera.position.x - controls.target.x;
  const dz = camera.position.z - controls.target.z;
  const len = Math.hypot(dx, y, dz) || 1;
  return y / len > 0.78;
}

export type CraftView = {
  setVehicle: (vehicle: CraftVehicle) => void;
  setCam: (cam: CraftViewCam) => void;
  setAlive: (on: boolean) => void;
  setGrounded: (on: boolean) => void;
  setPose: (act: CraftPose, tar: CraftPose) => void;
  resize: () => void;
  dispose: () => void;
};

export function createCraftView(
  canvas: HTMLCanvasElement,
  opts: { onBackdrop?: (down: boolean) => void } = {},
): CraftView {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0x000000), 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 24);
  scene.add(new AmbientLight(0xffffff, 0.7));
  const key = new DirectionalLight(0xffffff, 1.15);
  key.position.set(0.6, 1.4, 1.2);
  scene.add(key);

  const actFill = makeFill(BODY, 1);
  const actEdge = makeEdge(CYAN, 1);
  const tarFill = makeFill(GHOST, 0.08);
  const tarEdge = makeEdge(GHOST, 0.72);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.minDistance = 1.35;
  controls.maxDistance = 5.2;
  controls.rotateSpeed = 0.72;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI - 0.06;

  let vehicle: CraftVehicle = "plane";
  let cam: CraftViewCam = "rear";
  let alive = true;
  let grounded = false;
  let lastAct: CraftPose = { roll: 0, pitch: 0, yaw: 0 };
  let lastTar: CraftPose = { roll: 0, pitch: 0, yaw: 0 };
  let act = buildVehicle(vehicle, actFill, actEdge);
  let tar = buildVehicle(vehicle, tarFill, tarEdge);
  tar.scale.setScalar(1.03);
  scene.add(tar, act);
  snapCam(camera, controls, cam);

  function paintChrome() {
    actFill.color.setHex(alive ? BODY : IDLE_BODY);
    actEdge.color.setHex(!alive ? GREY : grounded ? AMBER : CYAN);
    tar.visible = alive;
  }

  function pose() {
    applyAtt(act, lastAct, cam);
    applyAtt(tar, lastTar, cam);
  }

  function paint() {
    renderer.render(scene, camera);
  }

  function backdrop() {
    opts.onBackdrop?.(lookingDown(camera, controls));
  }

  controls.addEventListener("change", () => {
    backdrop();
    paint();
  });
  backdrop();

  return {
    setVehicle(next) {
      if (next === vehicle) return;
      vehicle = next;
      scene.remove(act, tar);
      disposeTree(act);
      disposeTree(tar);
      act = buildVehicle(vehicle, actFill, actEdge);
      tar = buildVehicle(vehicle, tarFill, tarEdge);
      tar.scale.setScalar(1.03);
      scene.add(tar, act);
      pose();
      paintChrome();
      paint();
    },
    setCam(next) {
      cam = next;
      snapCam(camera, controls, cam);
      pose();
      backdrop();
      paint();
    },
    setAlive(on) {
      if (alive === on) return;
      alive = on;
      paintChrome();
      paint();
    },
    setGrounded(on) {
      grounded = on;
      paintChrome();
      paint();
    },
    setPose(actPose, tarPose) {
      lastAct = actPose;
      lastTar = tarPose;
      pose();
      paint();
    },
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      paint();
    },
    dispose() {
      controls.dispose();
      scene.remove(act, tar);
      disposeTree(act);
      disposeTree(tar);
      actFill.dispose();
      actEdge.dispose();
      tarFill.dispose();
      tarEdge.dispose();
      renderer.dispose();
    },
  };
}
