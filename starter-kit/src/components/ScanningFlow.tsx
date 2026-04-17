"use client";

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

const VIEWS: View[] = [
  { label: "Front View", instruction: "Smile and look straight at the camera." },
  { label: "Left View", instruction: "Turn your head to the left." },
  { label: "Right View", instruction: "Turn your head to the right." },
  { label: "Upper Teeth", instruction: "Tilt your head back and open wide." },
  { label: "Lower Teeth", instruction: "Tilt your head down and open wide." },
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
  // Sparse array indexed by view — lets users retake any single slot without
  // erasing later captures. `currentStep` is the slot being filmed right now.
  const [capturedImages, setCapturedImages] = useState<(string | null)[]>(
    () => Array(VIEWS.length).fill(null),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [captureBlockedUntil, setCaptureBlockedUntil] = useState(0);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  // Tracks whether we've started an upload for the current completed set so
  // the upload effect doesn't re-fire when submit.status changes mid-flight.
  const uploadStarted = useRef(false);

  const allCaptured = capturedImages.every((img) => img !== null);
  const capturing = !allCaptured;
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
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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
      setCamError(
        "Camera access was blocked. Enable permissions in your browser and reload.",
      );
    }
  }, []);

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
    // Downscale to ~720p max to keep payloads sane.
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    // Build the new images array here so we can derive next step without
    // calling setCurrentStep inside a state updater (which must be pure).
    const nextImages = [...capturedImages];
    nextImages[currentStep] = dataUrl;
    setCapturedImages(nextImages);
    const nextEmpty = nextImages.findIndex((img) => img === null);
    setCurrentStep(nextEmpty === -1 ? VIEWS.length : nextEmpty);
    setCaptureBlockedUntil(Date.now() + 2000);
  }, [currentStep, capturedImages]);

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

  // Auto-capture countdown: once the frame is stable enough, tick 3→2→1 and
  // fire the capture. Any dip back to "poor" cancels and restarts on re-stability.
  // Depending on `currentStep` ensures the countdown re-arms after each capture
  // even if `stable` happens to stay true across the step transition.
  const stable = facePresent && quality === "good";
  useEffect(() => {
    if (!capturing || !camReady) {
      setCountdown(null);
      return;
    }
    if (!stable || Date.now() < captureBlockedUntil) {
      setCountdown(null);
      return;
    }
    if (countdown === null) {
      setCountdown(3);
      return;
    }
    if (countdown === 0) {
      handleCapture();
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 700);
    return () => clearTimeout(t);
  }, [stable, countdown, capturing, camReady, handleCapture, currentStep, captureBlockedUntil]);

  // Once all 5 frames are captured, upload the scan and trigger notification.
  // uploadStarted ref prevents re-firing when submit.status changes mid-flight,
  // which would otherwise cancel the in-progress fetch via the cleanup function.
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
          setSubmit({
            status: "error",
            message: e instanceof Error ? e.message : "Upload failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [allCaptured, capturedImages]);

  const captureReady =
    camReady && facePresent && (quality === "good" || quality === "fair");


  const headerLabel = useMemo(
    () => (capturing ? VIEWS[currentStep].label : "Scan complete"),
    [capturing, currentStep],
  );

  return (
    <div className="flex h-[100svh] flex-col items-center overflow-hidden bg-black text-white">
      <div className="flex w-full shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2 backdrop-blur">
        <h1 className="text-sm font-semibold tracking-tight text-blue-400">
          DentalScan AI
        </h1>
        <span className="text-[11px] uppercase tracking-widest text-zinc-500">
          {capturing ? `Step ${currentStep + 1} / ${VIEWS.length}` : headerLabel}
        </span>
      </div>

      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-zinc-950">
        {capturing ? (
          <>
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
                <MouthGuide
                  quality={camReady && facePresent ? quality : "idle"}
                  stability={stability}
                  label={VIEWS[currentStep].label}
                  hint={VIEWS[currentStep].instruction}
                />
                <div className="pointer-events-none absolute inset-x-0 top-6 flex flex-col items-center text-center">
                  <p className="text-base font-semibold text-white drop-shadow">
                    Say Cheese!
                  </p>
                  <p className="mt-1 text-xs text-zinc-200 drop-shadow">
                    Open Mouth to Show the Teeth
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400 drop-shadow">
                    Focus Teeth in the Highlighted Area
                  </p>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-300 drop-shadow">
                    {VIEWS[currentStep].label}
                  </p>
                </div>
                {countdown !== null && countdown > 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span
                      key={countdown}
                      className="countdown-num text-8xl font-thin tabular-nums leading-none text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.75)]"
                    >
                      {countdown}
                    </span>
                    <span
                      key={`ring-${countdown}`}
                      className="countdown-ring absolute h-24 w-24 rounded-full border border-white/70"
                    />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* Upload / dashboard state */
          submit.status === "submitting" ? (
            <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
              <Loader2 size={40} className="animate-spin text-blue-400" />
              <h2 className="text-lg font-semibold">Uploading your scan…</h2>
              <p className="text-xs text-zinc-400">
                Securely sending {capturedImages.filter(Boolean).length} frames to the clinic.
              </p>
            </div>
          ) : submit.status === "error" ? (
            <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
              <h2 className="text-lg font-semibold text-red-300">Upload failed</h2>
              <p className="text-xs text-zinc-400">{submit.message}</p>
              <button
                onClick={() => { uploadStarted.current = false; setSubmit({ status: "idle" }); }}
                className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-200 hover:border-blue-500"
              >
                Retry upload
              </button>
            </div>
          ) : submit.status === "done" ? (
            <ScanDashboard
              scanId={submit.scanId}
              capturedImages={capturedImages}
              viewLabels={VIEWS.map((v) => v.label)}
              onReset={handleReset}
            />
          ) : null
        )}
      </div>

      {/* Capture button + thumbnails only shown while scanning */}
      {capturing && (
        <>
          <div className="flex w-full shrink-0 flex-col items-center gap-2 px-6 py-3">
            <button
              onClick={handleCapture}
              disabled={!captureReady}
              aria-label={`Capture ${VIEWS[currentStep].label}`}
              className="group flex h-16 w-16 items-center justify-center rounded-full border-4 border-white transition-transform active:scale-90 disabled:cursor-not-allowed disabled:border-zinc-700"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  captureReady
                    ? quality === "good"
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                    : "bg-zinc-700"
                }`}
              >
                <Camera
                  size={18}
                  className={captureReady ? "text-black" : "text-zinc-400"}
                />
              </div>
            </button>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {countdown !== null
                ? `Hold still — capturing in ${countdown}`
                : captureReady
                  ? "Hold still — auto-capturing"
                  : !camReady
                    ? "Starting camera…"
                    : !facePresent
                      ? "Center your face in the circle"
                      : "Hold still — steadying"}
            </p>
          </div>

          <div className="flex w-full shrink-0 gap-2 overflow-x-auto px-4 pb-3">
            {VIEWS.map((v, i) => {
              const filled = Boolean(capturedImages[i]);
              const active = i === currentStep;
              return (
                <button
                  key={v.label}
                  onClick={() => (filled ? handleRetake(i) : undefined)}
                  disabled={!filled}
                  className={`relative flex h-14 w-12 shrink-0 flex-col overflow-hidden rounded-lg border-2 text-left transition ${
                    active
                      ? "border-blue-500 bg-blue-500/10"
                      : filled
                        ? "border-zinc-700 hover:border-blue-500"
                        : "border-zinc-800"
                  }`}
                  aria-label={filled ? `Retake ${v.label}` : `${v.label} not yet captured`}
                >
                  {filled ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={capturedImages[i] as string}
                        alt={v.label}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70">
                        <X size={9} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
                      {i + 1}
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-300">
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
