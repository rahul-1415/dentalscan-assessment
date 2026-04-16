"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import MouthGuide from "./MouthGuide";
import QuickMessageSidebar from "./QuickMessageSidebar";
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
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const capturing = currentStep < VIEWS.length;
  const { stability, quality } = useFrameStability(videoRef, capturing && camReady);

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
    setCapturedImages((prev) => [...prev, dataUrl]);
    setCurrentStep((prev) => prev + 1);
  }, []);

  const handleRetake = useCallback((index: number) => {
    setCapturedImages((prev) => prev.slice(0, index));
    setCurrentStep(index);
    setSubmit({ status: "idle" });
  }, []);

  const handleReset = useCallback(() => {
    setCapturedImages([]);
    setCurrentStep(0);
    setSubmit({ status: "idle" });
  }, []);

  // Once all 5 frames are captured, upload the scan and trigger notification.
  useEffect(() => {
    if (currentStep !== VIEWS.length || submit.status !== "idle") return;
    let cancelled = false;

    (async () => {
      setSubmit({ status: "submitting" });
      try {
        const res = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            images: capturedImages,
          }),
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const data = (await res.json()) as { scan: { id: string } };
        if (!cancelled) setSubmit({ status: "done", scanId: data.scan.id });
      } catch (e) {
        if (!cancelled) {
          setSubmit({
            status: "error",
            message: e instanceof Error ? e.message : "Upload failed",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentStep, capturedImages, submit.status]);

  const captureReady = camReady && (quality === "good" || quality === "fair");
  const scanId = submit.status === "done" ? submit.scanId : null;

  const headerLabel = useMemo(
    () => (capturing ? VIEWS[currentStep].label : "Scan complete"),
    [capturing, currentStep],
  );

  return (
    <div className="flex min-h-screen flex-col items-center bg-black text-white">
      <div className="flex w-full items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-semibold tracking-tight text-blue-400">
          DentalScan AI
        </h1>
        <span className="text-[11px] uppercase tracking-widest text-zinc-500">
          {capturing ? `Step ${currentStep + 1} / ${VIEWS.length}` : headerLabel}
        </span>
      </div>

      <div className="relative flex aspect-[3/4] w-full max-w-md items-center justify-center overflow-hidden bg-zinc-950">
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
              <MouthGuide
                quality={camReady ? quality : "idle"}
                stability={stability}
                label={VIEWS[currentStep].label}
                hint={VIEWS[currentStep].instruction}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            {submit.status === "submitting" && (
              <>
                <Loader2 size={40} className="animate-spin text-blue-400" />
                <h2 className="text-lg font-semibold">Uploading your scan…</h2>
                <p className="text-xs text-zinc-400">
                  Securely sending {capturedImages.length} frames to the clinic.
                </p>
              </>
            )}
            {submit.status === "done" && (
              <>
                <CheckCircle2 size={44} className="text-emerald-400" />
                <h2 className="text-lg font-semibold">Scan uploaded</h2>
                <p className="max-w-xs text-xs text-zinc-400">
                  Your clinic has been notified. They&apos;ll review the scan and
                  reply in the chat below.
                </p>
                <p className="text-[10px] text-zinc-600">
                  Reference: {submit.scanId.slice(0, 12)}
                </p>
              </>
            )}
            {submit.status === "error" && (
              <>
                <h2 className="text-lg font-semibold text-red-300">
                  Upload failed
                </h2>
                <p className="text-xs text-zinc-400">{submit.message}</p>
                <button
                  onClick={() => setSubmit({ status: "idle" })}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-xs text-zinc-200 hover:border-blue-500"
                >
                  Retry upload
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-3 px-6 py-6">
        {capturing ? (
          <>
            <button
              onClick={handleCapture}
              disabled={!captureReady}
              aria-label={`Capture ${VIEWS[currentStep].label}`}
              className="group flex h-20 w-20 items-center justify-center rounded-full border-4 border-white transition-transform active:scale-90 disabled:cursor-not-allowed disabled:border-zinc-700"
            >
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                  captureReady
                    ? quality === "good"
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                    : "bg-zinc-700"
                }`}
              >
                <Camera
                  className={captureReady ? "text-black" : "text-zinc-400"}
                />
              </div>
            </button>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {captureReady
                ? "Tap to capture"
                : camReady
                  ? "Waiting for a stable frame"
                  : "Starting camera…"}
            </p>
          </>
        ) : (
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:border-blue-500 hover:text-white"
          >
            <RefreshCw size={14} /> Start a new scan
          </button>
        )}
      </div>

      <div className="flex w-full gap-2 overflow-x-auto px-4 pb-6">
        {VIEWS.map((v, i) => {
          const filled = Boolean(capturedImages[i]);
          const active = i === currentStep;
          return (
            <button
              key={v.label}
              onClick={() => (filled ? handleRetake(i) : undefined)}
              disabled={!filled}
              className={`relative flex h-20 w-16 shrink-0 flex-col overflow-hidden rounded-lg border-2 text-left transition ${
                active
                  ? "border-blue-500 bg-blue-500/10"
                  : filled
                    ? "border-zinc-700 hover:border-blue-500"
                    : "border-zinc-800"
              }`}
              aria-label={filled ? `Retake ${v.label}` : `${v.label} not yet captured`}
            >
              {filled ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={capturedImages[i]}
                  alt={v.label}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
                  {i + 1}
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9px] uppercase tracking-wider text-zinc-300">
                {v.label.replace(" View", "")}
              </span>
            </button>
          );
        })}
      </div>

      <QuickMessageSidebar
        scanId={scanId}
        defaultOpen={submit.status === "done"}
      />
    </div>
  );
}
