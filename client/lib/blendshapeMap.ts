import * as THREE from "three";
import { VRM, VRMLoaderPlugin, VRMHumanBoneName } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { HeadPose, PoseFrame } from "@/hooks/useFaceMesh";

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
  // Position is a temporary placeholder — the real camera is set by
  // frameHeadClose() once the model loads, so it adapts to chibi vs adult
  // VRMs without a hard-coded head Y.
  const camera = new THREE.PerspectiveCamera(20, 1, 0.01, 20);
  camera.position.set(0, 1.4, 3);
  camera.lookAt(0, 1.4, 0);
  return camera;
}

const _fh_v3 = new THREE.Vector3();
const _fh_box = new THREE.Box3();

/**
 * Aim the camera at the model's head for a close-up. Works for any VRM
 * (chibi or realistic) by reading the head bone, and falls back to the
 * top of the model's bounding box when no humanoid rig is present.
 */
export function frameHeadClose(
  camera: THREE.PerspectiveCamera,
  model: THREE.Object3D,
  vrm?: VRM,
) {
  _fh_box.setFromObject(model);
  const height = _fh_box.max.y - _fh_box.min.y;
  if (height <= 0) return;

  let headY: number;
  const headBone = vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
  if (headBone) {
    headBone.getWorldPosition(_fh_v3);
    // The head bone sits at the base of the skull — nudge up toward the eyes
    // for a nicer eyeline-level framing.
    headY = _fh_v3.y + height * 0.05;
  } else {
    // No rig — assume the head sits in the top ~10% of the model.
    headY = _fh_box.min.y + height * 0.9;
  }

  // Distance scales with model size: 45% of full-body height gives a tight
  // head + shoulders framing at fov 20 regardless of chibi vs realistic scale.
  const dist = Math.max(height * 0.45, 0.4);
  camera.position.set(0, headY, dist);
  camera.lookAt(0, headY, 0);
  camera.updateProjectionMatrix();
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

export function applyBlendshapes(
  vrm: VRM,
  values: Record<string, number>,
  mirror: boolean = false,
) {
  const em = vrm.expressionManager;
  if (!em) return;

  // Eyes: prefer independent per-eye presets when the model has them (so
  // winks work). If we ALSO drove the combined `blink` at max(L,R), a partial
  // closure of one eye would stack with the per-eye track and shut both eyes,
  // which is what happens on models where `blink` and `blinkLeft` target the
  // same blend morphs. For rigs without per-eye tracks, fall back to `blink`
  // gated on the MIN of the two — a real blink only when both eyes close.
  //
  // MediaPipe labels eyes from the SUBJECT's POV (biological left = the eye
  // on the character's left side). For self-view we swap L↔R so it reads as
  // a mirror: closing your biological left eye closes the eye that appears
  // on the LEFT of your screen. Remote view stays raw (peer sees you face-
  // to-face, so no swap).
  const bl = values.eyeBlinkLeft ?? 0;
  const br = values.eyeBlinkRight ?? 0;
  if (em.getExpression("blinkLeft") && em.getExpression("blinkRight")) {
    em.setValue("blinkLeft", mirror ? br : bl);
    em.setValue("blinkRight", mirror ? bl : br);
  } else {
    em.setValue("blink", Math.min(bl, br));
  }

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

  // Gaze direction is symmetric between self and remote views (viewer always
  // sees the eyes move to the same side of the screen as the user's own
  // biological gaze direction — mirror UX and face-to-face give the same
  // visual). So NO mirror swap here, unlike per-eye blinks above.
  em.setValue("lookLeft", values.eyeLookOutLeft ?? 0);
  em.setValue("lookRight", values.eyeLookOutRight ?? 0);
  em.setValue("lookUp", Math.max(values.eyeLookUpLeft ?? 0, values.eyeLookUpRight ?? 0));
  em.setValue("lookDown", Math.max(values.eyeLookDownLeft ?? 0, values.eyeLookDownRight ?? 0));

  em.update();
}

// Clamp head rotation to a comfortable range so noisy detections don't snap the
// head into a broken pose. Values are radians (~45° yaw, ~30° pitch/roll).
const YAW_LIMIT = Math.PI / 4;
const PITCH_LIMIT = Math.PI / 6;
const ROLL_LIMIT = Math.PI / 6;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Apply MediaPipe-derived head pose to the VRM head bone.
 *
 * NOTE on mirror: unlike per-eye blinks, head rotation is symmetric between
 * self-view and remote-view. When the user turns their biological right, BOTH
 * a self-view (mirror UX) and a remote-view (face-to-face UX) want to see the
 * head visually move to the LEFT of the viewer's screen. The `mirror` param
 * is accepted for API symmetry with applyBlendshapes but is intentionally
 * ignored — swapping yaw/roll signs here would break BOTH views.
 *
 * @param smooth  0..1 exponential smoothing factor per frame (0.35 is a mild
 *                low-pass that hides jitter without noticeable lag).
 */
export function applyHeadRotation(
  vrm: VRM,
  head: HeadPose,
  _mirror: boolean,
  smooth: number = 0.35,
) {
  const bone = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
  if (!bone) return;

  // MediaPipe camera frame has Y up when the face is upright, but the canonical
  // face looks toward +Z, whereas the VRM head bone's forward is -Z. That flips
  // pitch and yaw signs. Roll (Z) matches.
  const pitch = clamp(-head.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  const yaw = clamp(-head.yaw, -YAW_LIMIT, YAW_LIMIT);
  const roll = clamp(head.roll, -ROLL_LIMIT, ROLL_LIMIT);

  bone.rotation.order = "YXZ";
  bone.rotation.x = bone.rotation.x + (pitch - bone.rotation.x) * smooth;
  bone.rotation.y = bone.rotation.y + (yaw - bone.rotation.y) * smooth;
  bone.rotation.z = bone.rotation.z + (roll - bone.rotation.z) * smooth;
}

// Upper-body sway. Chest picks up L↔R tilt and torso twist. Both self-view
// and remote-view want the same visual direction — leaning left as the user
// should read as "left side of screen down" whether it's a mirror preview or
// a face-to-face remote view — so no mirror-based sign swap here (unlike
// per-eye blink which is a "which side" concept, not a "which direction").
const CHEST_ROLL_LIMIT = Math.PI / 6;    // ~30°
const CHEST_YAW_LIMIT = Math.PI / 6;
const CHEST_ROLL_GAIN = 0.6;
const CHEST_YAW_GAIN = 0.5;

/**
 * Apply MediaPipe pose-derived upper-body sway to the VRM chest/spine bone.
 * Route C: shoulders only, no arm tracking.
 */
export function applyUpperBody(
  vrm: VRM,
  pose: PoseFrame,
  _mirror: boolean,
  smooth: number = 0.15,
) {
  const chest = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    ?? vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
  if (!chest) return;

  // Sign convention: shoulderRoll is positive when the user's biological right
  // shoulder is UP. VRM chest.rotation.z on our 180°-flipped model needs the
  // NEGATED value to make "right shoulder up (biological)" appear as "left
  // side of the screen up" for both viewers.
  const roll = clamp(-pose.shoulderRoll * CHEST_ROLL_GAIN, -CHEST_ROLL_LIMIT, CHEST_ROLL_LIMIT);
  const yaw = clamp(pose.shoulderYaw * CHEST_YAW_GAIN, -CHEST_YAW_LIMIT, CHEST_YAW_LIMIT);

  chest.rotation.order = "YXZ";
  chest.rotation.y = chest.rotation.y + (yaw - chest.rotation.y) * smooth;
  chest.rotation.z = chest.rotation.z + (roll - chest.rotation.z) * smooth;
}

export interface FramingTargets {
  /** Head close-up: eye level Y, tight distance. */
  head: { y: number; z: number };
  /** Head + upper body: eye level slightly higher, camera pulled back to
   *  include shoulders. */
  upperBody: { y: number; z: number };
}

/**
 * Precompute two camera framings from a loaded model. VrmAvatar interpolates
 * between them based on whether pose tracking is emitting shoulder data.
 */
export function computeFramings(
  model: THREE.Object3D,
  vrm?: VRM,
): FramingTargets | null {
  _fh_box.setFromObject(model);
  const height = _fh_box.max.y - _fh_box.min.y;
  if (height <= 0) return null;

  let headY: number;
  let chestY: number;
  const headBone = vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
  const chestBone = vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    ?? vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
  if (headBone) {
    headBone.getWorldPosition(_fh_v3);
    headY = _fh_v3.y + height * 0.05;
  } else {
    headY = _fh_box.min.y + height * 0.9;
  }
  if (chestBone) {
    chestBone.getWorldPosition(_fh_v3);
    chestY = _fh_v3.y;
  } else {
    chestY = _fh_box.min.y + height * 0.6;
  }

  return {
    head: {
      y: headY,
      z: Math.max(height * 0.45, 0.4),
    },
    upperBody: {
      y: (headY + chestY) / 2 + height * 0.05,
      z: Math.max(height * 0.9, 0.7),
    },
  };
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
