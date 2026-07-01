import * as THREE from "three";
import { VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function createLighting(scene: THREE.Scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(1, 2.5, 3);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xccccff, 0.8);
  fill.position.set(-1.5, 1, -1);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(0, 1.0, -2);
  scene.add(rim);
}

export function createRenderer(canvas: HTMLCanvasElement, size: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  createLighting(scene);
  return scene;
}

export function createCamera(size: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(16, 1, 0.1, 20);
  camera.position.set(0, 1.4, 4.2);
  camera.lookAt(0, 1.05, 0);
  return camera;
}

export async function loadVRM(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.crossOrigin = "anonymous";
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;

  vrm.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.frustumCulled = false;
    }
  });

  return vrm;
}

export function applyBlendshapes(vrm: VRM, values: Record<string, number>) {
  const em = vrm.expressionManager;
  if (!em) return;

  em.setValue("blinkLeft", values.eyeBlinkLeft ?? 0);
  em.setValue("blinkRight", values.eyeBlinkRight ?? 0);
  em.setValue("blink", Math.max(values.eyeBlinkLeft ?? 0, values.eyeBlinkRight ?? 0));

  const jawOpen = values.jawOpen ?? 0;
  em.setValue("aa", jawOpen);

  const smile = Math.max(values.mouthSmileLeft ?? 0, values.mouthSmileRight ?? 0);
  const frown = Math.max(values.mouthFrownLeft ?? 0, values.mouthFrownRight ?? 0);
  em.setValue("happy", smile);
  em.setValue("sad", frown);

  const browDown = Math.max(values.browDownLeft ?? 0, values.browDownRight ?? 0);
  em.setValue("angry", browDown * 0.8);

  const browUp = values.browInnerUp ?? 0;
  em.setValue("surprised", browUp * 0.6);

  const pucker = values.mouthPucker ?? 0;
  em.setValue("ou", pucker);

  const stretch = Math.max(values.mouthStretchLeft ?? 0, values.mouthStretchRight ?? 0);
  em.setValue("ee", stretch);

  em.setValue("lookLeft", values.eyeLookOutLeft ?? 0);
  em.setValue("lookRight", values.eyeLookOutRight ?? 0);
  em.setValue("lookUp", Math.max(values.eyeLookUpLeft ?? 0, values.eyeLookUpRight ?? 0));
  em.setValue("lookDown", Math.max(values.eyeLookDownLeft ?? 0, values.eyeLookDownRight ?? 0));

  em.update();
}

export function createFallbackModel(): THREE.Group {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xffdbac,
    roughness: 0.6,
    metalness: 0,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), skinMat);
  head.position.y = 1.3;
  head.name = "head";
  group.add(head);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x5b8def,
    roughness: 0.3,
    metalness: 0,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 8, 16), bodyMat);
  body.position.y = 0.3;
  body.name = "body";
  group.add(body);

  // eyes
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.1 });

  function createEye(x: number) {
    const eyeGroup = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), eyeWhiteMat);
    eyeGroup.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), pupilMat);
    pupil.position.z = 0.08;
    eyeGroup.add(pupil);
    eyeGroup.position.set(x, 1.45, 0.45);
    eyeGroup.name = `eye_${x > 0 ? "r" : "l"}`;
    return eyeGroup;
  }

  const leftEye = createEye(-0.15);
  const rightEye = createEye(0.15);
  group.add(leftEye);
  group.add(rightEye);

  // blush
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff9999,
    roughness: 1,
    transparent: true,
    opacity: 0.3,
  });
  function createBlush(x: number) {
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), blushMat);
    blush.position.set(x, 1.2, 0.5);
    blush.name = `blush_${x > 0 ? "r" : "l"}`;
    return blush;
  }
  group.add(createBlush(-0.25));
  group.add(createBlush(0.25));

  // mouth indicator
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0xcc6666, roughness: 0.3 });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.01), mouthMat);
  mouth.position.set(0, 1.05, 0.5);
  mouth.name = "mouth";
  group.add(mouth);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  return group;
}

export function applyBlendshapesToFallback(
  group: THREE.Group,
  values: Record<string, number>,
  lerp: number = 0.25,
) {
  const eyes = [group.getObjectByName("eye_l"), group.getObjectByName("eye_r")];
  const blinkL = values.eyeBlinkLeft ?? 0;
  const blinkR = values.eyeBlinkRight ?? 0;

  eyes.forEach((eye, i) => {
    if (!eye) return;
    const target = i === 0 ? 1 - blinkL * 0.95 : 1 - blinkR * 0.95;
    const current = eye.scale.y;
    eye.scale.y = current + (target - current) * lerp;
  });

  const blushL = group.getObjectByName("blush_l");
  const blushR = group.getObjectByName("blush_r");
  const smile = Math.max(values.mouthSmileLeft ?? 0, values.mouthSmileRight ?? 0);
  if (blushL) blushL.scale.setScalar(1 + smile * 0.3);
  if (blushR) blushR.scale.setScalar(1 + smile * 0.3);

  const mouth = group.getObjectByName("mouth") as THREE.Mesh | undefined;
  if (mouth) {
    const jawOpen = values.jawOpen ?? 0;
    const targetY = 0.03 + jawOpen * 0.15;
    const targetX = 0.15 + smile * 0.1;
    mouth.scale.x = mouth.scale.x + (targetX - mouth.scale.x) * lerp;
    mouth.scale.y = mouth.scale.y + (targetY - mouth.scale.y) * lerp;
  }
}
