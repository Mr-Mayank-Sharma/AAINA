/**
 * Capture module — isolated behind an interface so real depth-camera /
 * alternative pose stacks can be swapped in later without touching the app
 * (design doc, Step 7 requirement).
 *
 * v2: MediaPipe Pose (BlazePose, 33 landmarks) runs in-browser on the captured
 * frame. Self-reported height calibrates pixel→cm scale; landmark distances
 * give shoulder width and torso ratios; population anthropometry converts
 * widths to circumferences for size recommendation.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface BodyMeasurements {
  height_cm: number;
  shoulder_width_cm: number;
  chest_cm: number;
  waist_cm: number;
  hip_cm: number;
  inseam_cm: number;
  body_shape_vector: Record<string, unknown>;
}

export interface CaptureResult {
  /** Base64 JPEG frame — transient; sent to API, stored in Redis only. */
  frameBase64: string;
  measurements: BodyMeasurements;
}

export interface CaptureModule {
  start(video: HTMLVideoElement): Promise<void>;
  capture(heightCm: number): Promise<CaptureResult>;
  stop(): void;
}

// BlazePose landmark indices.
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
      });
    })();
  }
  return landmarkerPromise;
}

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Clamp helper for anthropometric adjustments. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Convert landmarks + self-reported height into a measurement set.
 *
 * Scale: ear-to-ankle vertical span ≈ 93% of stature → pxToCm factor.
 * Circumferences: population stature fractions (chest ≈ 52.5%, waist ≈ 44%,
 * hip ≈ 54% of stature) modulated by the individual's measured width ratios,
 * clamped to ±15% so outliers can't produce absurd sizes.
 */
export function estimateFromLandmarks(
  landmarks: Pt[],
  heightCm: number,
): BodyMeasurements {
  const ls = landmarks[L_SHOULDER];
  const rs = landmarks[R_SHOULDER];
  const lh = landmarks[L_HIP];
  const rh = landmarks[R_HIP];
  const la = landmarks[L_ANKLE];
  const ra = landmarks[R_ANKLE];

  const earTop = mid(ls, rs); // proxy for upper anchor (ears not always visible)
  const ankleMid = mid(la, ra);

  // Vertical span from shoulders to ankles ≈ 75% of stature (biological ratio).
  const spanNorm = Math.abs(ankleMid.y - earTop.y);
  if (spanNorm < 0.15) throw new Error('Body not fully visible — step back and try again');
  const pxToCm = (heightCm * 0.75) / spanNorm;

  // Direct measurement: biacromial (shoulder joint-to-joint) width.
  const shoulderCm = dist(ls, rs) * pxToCm;

  // Width ratios vs population averages (biacromial ≈ 23.5%, hip ≈ 19.1% of stature).
  const shoulderRatio = shoulderCm / heightCm;
  const adjShoulder = clamp(shoulderRatio / 0.235, 0.85, 1.15);

  const hipWidthCm = dist(lh, rh) * pxToCm;
  const hipRatio = hipWidthCm / heightCm;
  const adjHip = clamp(hipRatio / 0.191, 0.85, 1.15);

  // Circumference estimates (stature fraction × width adjustment).
  const chestCm = Math.round(heightCm * 0.525 * adjShoulder);
  const waistCm = Math.round(heightCm * 0.44 * adjHip);
  // Hip circumference blends ellipse approximation of measured width with baseline.
  const hipEllipse = hipWidthCm * Math.PI * 0.78; // elliptical cross-section factor
  const hipBaseline = heightCm * 0.54 * adjHip;
  const hipCm = Math.round(hipEllipse * 0.4 + hipBaseline * 0.6);

  // Inseam: hip joints to ankle midpoint, slight extension to floor.
  const inseamCm = Math.round(dist(mid(lh, rh), ankleMid) * pxToCm * 1.04);

  // Shape classification from ratios.
  const whr = waistCm / hipCm; // waist-hip ratio
  const shr = shoulderCm / hipWidthCm; // shoulder-hip width ratio
  let shape = 'rectangle';
  if (whr < 0.75 && shr > 1.25) shape = 'hourglass';
  else if (whr >= 0.85 && shr < 1.05) shape = 'apple';
  else if (shr > 1.2 && whr >= 0.75) shape = 'inverted-triangle';
  else if (whr > 0.8 && shr <= 1.1) shape = 'pear';

  return {
    height_cm: Math.round(heightCm),
    shoulder_width_cm: Math.round(shoulderCm),
    chest_cm: chestCm,
    waist_cm: waistCm,
    hip_cm: hipCm,
    inseam_cm: inseamCm,
    body_shape_vector: {
      source: 'mediapipe-pose',
      version: 2,
      waist_hip_ratio: Number(whr.toFixed(3)),
      shoulder_hip_ratio: Number(shr.toFixed(3)),
      shape_classification: shape,
      calibration: 'self-reported-height',
    },
  };
}

export class WebcamCapture implements CaptureModule {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = this.stream;
    await video.play();
  }

  async capture(heightCm: number): Promise<CaptureResult> {
    if (!this.video) throw new Error('capture not started');

    // Grab the frame first (works even if pose model is still loading).
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext('2d')!.drawImage(this.video, 0, 0);
    const frameBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    // Real pose estimation — full body required.
    const landmarker = await getLandmarker();
    const result = landmarker.detect(canvas);
    const lm = result.landmarks?.[0];
    if (!lm || lm.length < 29) {
      throw new Error('Could not detect your full body — make sure head to ankles are in frame');
    }

    const points: Pt[] = lm.map((p) => ({ x: p.x, y: p.y }));
    return { frameBase64, measurements: estimateFromLandmarks(points, heightCm) };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
