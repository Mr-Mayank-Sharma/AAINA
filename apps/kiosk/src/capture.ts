/**
 * Capture module — isolated behind an interface so real depth-camera /
 * MediaPipe hardware can be swapped in later without touching the app
 * (design doc, Step 7 requirement).
 */
export interface CaptureResult {
  /** Base64 JPEG frame — transient; sent to API, stored in Redis only. */
  frameBase64: string;
  /** Parametric measurement set (cm). No facial data ever leaves this module. */
  measurements: {
    height_cm: number;
    shoulder_width_cm: number;
    chest_cm: number;
    waist_cm: number;
    hip_cm: number;
    inseam_cm: number;
    body_shape_vector: Record<string, unknown>;
  };
}

export interface CaptureModule {
  start(video: HTMLVideoElement): Promise<void>;
  capture(): Promise<CaptureResult>;
  stop(): void;
}

/**
 * MVP webcam capture: grabs a frame and returns placeholder measurements.
 * TODO(pilot): replace estimateMeasurements with MediaPipe Pose landmark
 * extraction — the interface stays identical.
 */
export class WebcamCapture implements CaptureModule {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = this.stream;
    await video.play();
  }

  async capture(): Promise<CaptureResult> {
    if (!this.video) throw new Error('capture not started');
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext('2d')!.drawImage(this.video, 0, 0);
    const frameBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    return {
      frameBase64,
      measurements: estimateMeasurements(),
    };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function estimateMeasurements() {
  // Placeholder parametric set until MediaPipe Pose is wired in.
  return {
    height_cm: 170,
    shoulder_width_cm: 42,
    chest_cm: 92,
    waist_cm: 78,
    hip_cm: 98,
    inseam_cm: 76,
    body_shape_vector: { source: 'webcam-mvp', version: 1 },
  };
}
