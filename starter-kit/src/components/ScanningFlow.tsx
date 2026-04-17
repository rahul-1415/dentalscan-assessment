"use client";

// [Task 01 — Scan Enhancement · R1 R2 R3]
// ScanningFlow is the main capture orchestrator. It owns:
//   • Camera lifecycle (getUserMedia → stream → teardown)
//   • Per-slot capture state (sparse array so retakes don't erase other images)
//   • Auto-capture countdown driven by useFrameStability quality signal
//   • Upload trigger and submit-state machine
//   • Rendering of MouthGuide overlay, capture button, and thumbnail strip

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Camera, Loader2, X } from "lucide-react";
import MouthGuide from "./MouthGuide";
import ScanDashboard from "./ScanDashboard";
import { useFrameStability } from "@/hooks/useFrameStability";

type View = {
  label: string;
  instruction: string;
};

// Five clinical angles required by the dental AI model
const VIEWS: View[] = [
  { label: "Front View",   instruction: "Smile and look straight at the camera." },
  { label: "Left View",    instruction: "Turn your head to the left." },
  { label: "Right View",   instruction: "Turn your head to the right." },
  { label: "Upper Teeth",  instruction: "Tilt your head back and open wide." },
  { label: "Lower Teeth",  instruction: "Tilt your head down and open wide." },
];

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; scanId: string }
  | { status: "error"; message: string };

export default function ScanningFlow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  // [Task 01 · R1: Visual Guidance — per-slot retake]
  // Sparse array (one slot per view) lets the user retake any single angle
  // without losing the other captures. currentStep tracks the active slot.
  const [capturedImages, setCapturedImages] = useState<(string | null)[]>(
    () => Array(VIEWS.length).fill(null),
  );
  const [currentStep, setCurrentStep] = useState(0);

  // [Task 01 · R1: 2-second inter-capture cooldown]
  // After each capture the countdown is blocked for 2 s so the ring doesn't
  // immediately re-arm and fire a second shot of the same view.
  const [captureBlockedUntil, setCaptureBlockedUntil] = useState(0);

  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  // [Task 02 · R3: Async Flow — upload gate ref]
  // A ref (not state) prevents the upload useEffect from re-firing when
  // setSubmit("submitting") changes the dep array mid-flight, which would
  // cancel the in-progress fetch via the cleanup function.
  const uploadStarted = useRef(false);

  const allCaptured = capturedImages.every((img) => img !== null);
  const capturing = !allCaptured;

  // [Task 01 · R2 R3: Quality Indicator — frame stability hook]
  // Only active while capturing AND camera is ready, so the RAF loop is
  // completely stopped after all frames are taken (zero media-feed overhead
  // during the upload / dashboard phase).
  const { stability, quality, facePresent } = useFrameStability(
    videoRef,
    capturing && camReady,
  );
  const [countdown, setCountdown] = useState<number | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamError("Camera API not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCamReady(true);
        setCamError(null);
      }
    } catch (err) {
      console.error("Camera access denied", err);
      setCamError("Camera access was blocked. Enable permissions in your browser and reload.");
    }
  }, []);

  // Start camera when entering capture mode; stop it when done
  useEffect(() => {
    if (capturing) {
      void startCamera();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [capturing, startCamera, stopStream]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = captureCanvasRef.current ?? document.createElement("canvas");
    captureCanvasRef.current = canvas;

    // [Task 01 · R1: Downscale to ~720p]
    // Keeps JPEG payloads reasonable (~150-300 KB each) without losing
    // clinically relevant detail.
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width  = Math.round(video.videoWidth  * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

    // [Task 01 · R1: Per-slot retake — no side-effects in state updater]
    // Derive nextImages and nextEmpty outside the updater so we can call
    // setCurrentStep directly. React can call updater functions multiple times
    // in StrictMode, so side-effects must live outside them.
    const nextImages = [...capturedImages];
    nextImages[currentStep] = dataUrl;
    setCapturedImages(nextImages);
    const nextEmpty = nextImages.findIndex((img) => img === null);
    setCurrentStep(nextEmpty === -1 ? VIEWS.length : nextEmpty);

    // [Task 01 · R1: 2-second cooldown after capture]
    setCaptureBlockedUntil(Date.now() + 2000);
  }, [currentStep, capturedImages]);

  // [Task 01 · R1: Per-slot retake handler]
  // Clears only the selected slot and resets the upload gate so a completed
  // set that was partially retaken can be re-uploaded.
  const handleRetake = useCallback((index: number) => {
    uploadStarted.current = false;
    setCapturedImages((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setCurrentStep(index);
    setSubmit({ status: "idle" });
  }, []);

  const handleReset = useCallback(() => {
    uploadStarted.current = false;
    setCapturedImages(Array(VIEWS.length).fill(null));
    setCurrentStep(0);
    setSubmit({ status: "idle" });
  }, []);

  // [Task 01 · R1 R2: Auto-capture countdown]
  // Ticks 3→2→1→capture once the frame is stable (facePresent + quality=good).
  // Any dip below "good" resets the countdown. Depending on currentStep
  // re-arms the countdown after each capture even if stable stays true
  // across the step transition (otherwise the effect won't re-run).
  const stable = facePresent && quality === "good";
  useEffect(() => {
    if (!capturing || !camReady) { setCountdown(null); return; }
    if (!stable || Date.now() < captureBlockedUntil) { setCountdown(null); return; }
    if (countdown === null) { setCountdown(3); return; }
    if (countdown === 0)    { handleCapture(); setCountdown(null); return; }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 700);
    return () => clearTimeout(t);
  }, [stable, countdown, capturing, camReady, handleCapture, currentStep, captureBlockedUntil]);

  // [Task 02 · R1 R3: Upload trigger — fires once all 5 frames are captured]
  // uploadStarted ref prevents re-entry when submit.status changes mid-flight.
  // The fetch is non-blocking for the user: they see the uploading state but
  // the scan record is already committed before notification creation, so a
  // notification failure never loses the scan. (R3 async flow)
  useEffect(() => {
    if (!allCaptured || uploadStarted.current) return;
    uploadStarted.current = true;

    let cancelled = false;
    setSubmit({ status: "submitting" });

    fetch("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "completed",
        images: capturedImages.filter((img): img is string => img !== null),
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        return res.json() as Promise<{ scan: { id: string } }>;
      })
      .then((data) => {
        if (!cancelled) setSubmit({ status: "done", scanId: data.scan.id });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setSubmit({ status: "error", message: e instanceof Error ? e.message : "Upload failed" });
      });

    return () => { cancelled = true; };
  }, [allCaptured, capturedImages]);

  // [Task 01 · R2: captureReady gates the manual shutter button]
  // Requires face present so the button is disabled when no face is detected —
  // consistent with the auto-capture behaviour.
  const captureReady = camReady && facePresent && (quality === "good" || quality === "fair");

  const headerLabel = useMemo(
    () => (capturing ? VIEWS[currentStep].label : "Scan complete"),
    [capturing, currentStep],
  );

  return (
    <div className="flex h-[100svh] flex-col items-center overflow-hidden bg-black text-white">
      {/* Header — white bar, consistent with clinical light-theme */}
      <div className="flex w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight text-blue-600">DentalScan AI</h1>
        <span className="text-[11px] uppercase tracking-widest text-zinc-400">
          {capturing ? `Step ${currentStep + 1} / ${VIEWS.length}` : headerLabel}
        </span>
      </div>

      {/* Camera viewport */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-zinc-950">
        {capturing ? (
          <>
            {/* [Task 01 · R1: Live camera feed]
                -scale-x-100 mirrors the stream so it acts like a selfie mirror,
                making it natural for patients to centre their mouth. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
              aria-label="Live camera preview"
            />

            {camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center text-sm text-red-300">
                {camError}
              </div>
            )}

            {!camError && (
              <>
                {/* [Task 01 · R1 R2: MouthGuide overlay]
                    quality is set to "idle" when no face is detected so the ring
                    never turns green just because the frame happens to be still
                    (e.g. camera pointed at a blank wall). */}
                <MouthGuide
                  quality={camReady && facePresent ? quality : "idle"}
                  stability={stability}
                  label={VIEWS[currentStep].label}
                  hint={VIEWS[currentStep].instruction}
                />

                {/* Instructional overlays above and below the ring */}
                <div className="pointer-events-none absolute inset-x-0 top-6 flex flex-col items-center text-center">
                  <p className="text-2xl font-bold text-white drop-shadow">Say Cheese!</p>
                  <p className="mt-1.5 text-sm font-medium text-zinc-100 drop-shadow">Open Mouth to Show the Teeth</p>
                  <p className="mt-1 text-xs text-zinc-300 drop-shadow">Focus Teeth in the Highlighted Area</p>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-1 text-center">
                  <p className="text-sm font-semibold uppercase tracking-widest text-white drop-shadow">
                    {VIEWS[currentStep].label}
                  </p>
                  <p className="text-xs text-zinc-300 drop-shadow">{VIEWS[currentStep].instruction}</p>
                </div>

                {/* [Task 01 · R1: Auto-capture countdown animation] */}
                {countdown !== null && countdown > 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span key={countdown} className="countdown-num text-8xl font-thin tabular-nums leading-none text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.75)]">
                      {countdown}
                    </span>
                    <span key={`ring-${countdown}`} className="countdown-ring absolute h-24 w-24 rounded-full border border-white/70" />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* Post-capture states */
          submit.status === "submitting" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-50 p-10 text-center">
              <Loader2 size={40} className="animate-spin text-blue-500" />
              <h2 className="text-lg font-semibold text-zinc-800">Uploading your scan…</h2>
              <p className="text-xs text-zinc-500">
                Securely sending {capturedImages.filter(Boolean).length} frames to the clinic.
              </p>
            </div>
          ) : submit.status === "error" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-50 p-10 text-center">
              <h2 className="text-lg font-semibold text-red-500">Upload failed</h2>
              <p className="text-xs text-zinc-500">{submit.message}</p>
              {/* [Task 02 · R3: Retry — resets uploadStarted gate before retrying] */}
              <button
                onClick={() => { uploadStarted.current = false; setSubmit({ status: "idle" }); }}
                className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600 hover:border-blue-400 hover:text-blue-600"
              >
                Retry upload
              </button>
            </div>
          ) : submit.status === "done" ? (
            /* [Task 03 · R1: Post-scan dashboard]
               fixed inset-0 breaks out of the 430px phone column so ScanDashboard
               fills the full browser viewport — appropriate for the results + chat UI. */
            <div className="fixed inset-0 z-50 overflow-hidden">
              <ScanDashboard
                scanId={submit.scanId}
                capturedImages={capturedImages}
                viewLabels={VIEWS.map((v) => v.label)}
                onReset={handleReset}
              />
            </div>
          ) : null
        )}
      </div>

      {/* [Task 01 · R1 R2: Capture controls — only shown while scanning] */}
      {capturing && (
        <>
          {/* Manual shutter button + status hint */}
          <div className="flex w-full shrink-0 flex-col items-center gap-2 border-t border-zinc-200 bg-white px-6 py-3">
            {/* [Task 01 · R2: Button colour mirrors quality state]
                Green = good quality, amber = fair, grey = not ready */}
            <button
              onClick={handleCapture}
              disabled={!captureReady}
              aria-label={`Capture ${VIEWS[currentStep].label}`}
              className="group flex h-16 w-16 items-center justify-center rounded-full border-4 border-zinc-300 transition-transform active:scale-90 disabled:cursor-not-allowed disabled:border-zinc-200"
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                captureReady
                  ? quality === "good" ? "bg-emerald-400" : "bg-amber-400"
                  : "bg-zinc-200"
              }`}>
                <Camera size={18} className={captureReady ? "text-black" : "text-zinc-400"} />
              </div>
            </button>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">
              {countdown !== null
                ? `Hold still — capturing in ${countdown}`
                : captureReady     ? "Hold still — auto-capturing"
                : !camReady        ? "Starting camera…"
                : !facePresent     ? "Center your face in the circle"
                :                    "Hold still — steadying"}
            </p>
          </div>

          {/* [Task 01 · R1: Thumbnail strip — per-slot retake]
              Each filled slot shows the captured image with an X badge so users
              know they can tap to retake that specific angle. Active slot is
              highlighted blue. Empty slots show their step number. */}
          <div className="flex w-full shrink-0 gap-2 overflow-x-auto bg-white px-4 pb-4 pt-1">
            {VIEWS.map((v, i) => {
              const filled = Boolean(capturedImages[i]);
              const active = i === currentStep;
              return (
                <button
                  key={v.label}
                  onClick={() => (filled ? handleRetake(i) : undefined)}
                  disabled={!filled}
                  className={`relative flex h-14 w-12 shrink-0 flex-col overflow-hidden rounded-lg border-2 text-left transition ${
                    active  ? "border-blue-500 bg-blue-50"
                    : filled ? "border-zinc-300 hover:border-blue-400"
                    :          "border-zinc-200"
                  }`}
                  aria-label={filled ? `Retake ${v.label}` : `${v.label} not yet captured`}
                >
                  {filled ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={capturedImages[i] as string} alt={v.label} className="h-full w-full object-cover" />
                      {/* X badge signals the retake affordance */}
                      <div className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60">
                        <X size={9} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">{i + 1}</div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-200">
                    {v.label.replace(" View", "")}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
