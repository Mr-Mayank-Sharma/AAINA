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
      // Assets are vendored under /public/mediapipe so the kiosk works with
      // zero internet — demo venues can't be trusted to have wifi.
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task',
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

// ── Entrance gate scanner ────────────────────────────────────────────────
// Hands-free variant: watches a live entrance-camera feed, detects a walker,
// and auto-captures the best frame during their crossing. No interaction.

let videoLandmarkerPromise: Promise<PoseLandmarker> | null = null;

function getVideoLandmarker(): Promise<PoseLandmarker> {
  if (!videoLandmarkerPromise) {
    videoLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
      });
    })();
  }
  return videoLandmarkerPromise;
}

export class GateScanner {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private landmarker: PoseLandmarker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private lastVideoTime = -1;

  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = this.stream;
    await video.play();
    this.landmarker = await getVideoLandmarker();
    this.canvas = document.createElement('canvas');
  }

  /**
   * Analyze the newest camera frame. Returns the body's vertical span ratio
   * plus landmarks when a full body is visible, else null. Cheap enough to
   * call every animation frame.
   */
  poll(): { span: number; points: Pt[] } | null {
    if (!this.video || !this.landmarker || !this.canvas || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastVideoTime) return null; // no new frame yet
    this.lastVideoTime = this.video.currentTime;

    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.canvas.getContext('2d')!.drawImage(this.video, 0, 0);

    const res = this.landmarker.detectForVideo(this.canvas, performance.now());
    const lm = res.landmarks?.[0];
    if (!lm || lm.length < 29) return null;

    const pts: Pt[] = lm.map((p) => ({ x: p.x, y: p.y }));
    const span = Math.abs(
      mid(pts[L_ANKLE], pts[R_ANKLE]).y - mid(pts[L_SHOULDER], pts[R_SHOULDER]).y,
    );
    if (span < 0.15) return null; // partial body — not scannable
    return { span, points: pts };
  }

  private snapshotBase64(): string {
    const v = this.video!;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  /**
   * Collect frames while the walker crosses the gate; keep the one with the
   * largest visible body (closest to the scan line). Falls back gracefully
   * when the walker exits between samples.
   */
  async captureBest(
    heightCm: number,
    opts?: { frames?: number; intervalMs?: number },
  ): Promise<CaptureResult> {
    const frames = opts?.frames ?? 6;
    const intervalMs = opts?.intervalMs ?? 180;
    let best: { score: number; base64: string; points: Pt[] } | null = null;

    for (let i = 0; i < frames; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const hit = this.poll();
      if (!hit) continue;
      const score = hit.span;
      if (!best || score > best.score) {
        best = { score, base64: this.snapshotBase64(), points: hit.points };
      }
    }
    if (!best) throw new Error('No clear body capture — please walk through again');
    return { frameBase64: best.base64, measurements: estimateFromLandmarks(best.points, heightCm) };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
