"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type Quality = "idle" | "poor" | "fair" | "good";

type Options = {
  sampleSize?: number;
  sampleIntervalMs?: number;
  smoothing?: number;
  goodThreshold?: number;
  fairThreshold?: number;
};

/**
 * Measures inter-frame pixel diff on a tiny downsampled canvas to produce
 * a 0..1 "stability" score without touching an ML model. Low diff between
 * frames → high stability; high diff → the phone (or face) is moving.
 *
 * Keeping the sample canvas small (64px by default) means the work per
 * frame is ~16KB of memory and a few hundred µs of CPU.
 */
export function useFrameStability(
  videoRef: RefObject<HTMLVideoElement>,
  active: boolean,
  opts: Options = {},
) {
  const {
    sampleSize = 64,
    sampleIntervalMs = 120,
    smoothing = 0.75,
    goodThreshold = 0.82,
    fairThreshold = 0.55,
  } = opts;

  const [stability, setStability] = useState(0);
  const [quality, setQuality] = useState<Quality>("idle");
  const stabilityRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setQuality("idle");
      setStability(0);
      stabilityRef.current = 0;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let prev: Uint8ClampedArray | null = null;
    let raf = 0;
    let lastSampleAt = 0;
    let cancelled = false;

    const tick = (t: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (t - lastSampleAt < sampleIntervalMs) return;
      lastSampleAt = t;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      ctx.drawImage(video, 0, 0, sampleSize, sampleSize);
      const frame = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

      if (prev) {
        let acc = 0;
        // Sample one channel (R) — correlated enough with luminance for
        // motion detection and half the work of computing true luma.
        for (let i = 0; i < frame.length; i += 4) {
          const d = frame[i] - prev[i];
          acc += d < 0 ? -d : d;
        }
        const meanDiff = acc / (sampleSize * sampleSize);
        // 0 diff → 1.0 stability; ~30 diff → 0. Past 30 clamps to 0.
        const raw = Math.max(0, Math.min(1, 1 - meanDiff / 30));
        const smoothed =
          stabilityRef.current * smoothing + raw * (1 - smoothing);
        stabilityRef.current = smoothed;
        setStability(smoothed);
        setQuality(
          smoothed >= goodThreshold
            ? "good"
            : smoothed >= fairThreshold
              ? "fair"
              : "poor",
        );
      }

      // Copy into a fresh buffer — the ImageData.data view is reused.
      prev = new Uint8ClampedArray(frame);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    active,
    videoRef,
    sampleSize,
    sampleIntervalMs,
    smoothing,
    goodThreshold,
    fairThreshold,
  ]);

  return { stability, quality };
}
