"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type Quality = "idle" | "poor" | "fair" | "good";

type Options = {
  sampleSize?: number;
  sampleIntervalMs?: number;
  smoothing?: number;
  goodThreshold?: number;
  fairThreshold?: number;
  skinRatioThreshold?: number;
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
    goodThreshold = 0.9,
    fairThreshold = 0.55,
    // Fraction of the frame that must look skin-colored for a face to be
    // considered "likely present." 12% is generous enough for a face at arm's
    // length but still rejects walls/ceilings/desks.
    skinRatioThreshold = 0.12,
  } = opts;

  const [stability, setStability] = useState(0);
  const [quality, setQuality] = useState<Quality>("idle");
  const [facePresent, setFacePresent] = useState(false);
  const stabilityRef = useRef(0);
  // Refs track last-committed values so we only call setState when something
  // actually changed — prevents spurious re-renders on every RAF tick.
  const lastQualityRef = useRef<Quality>("idle");
  const lastFacePresentRef = useRef(false);
  const lastStabilityRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setQuality("idle");
      setStability(0);
      setFacePresent(false);
      stabilityRef.current = 0;
      lastQualityRef.current = "idle";
      lastFacePresentRef.current = false;
      lastStabilityRef.current = 0;
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

      // Skin-tone gate: count pixels that roughly match human skin using a
      // simple RGB heuristic (Kovac et al., daylight rule). Cheap enough to
      // piggyback on the frame we already decoded.
      let skinCount = 0;
      let acc = 0;
      for (let i = 0; i < frame.length; i += 4) {
        const r = frame[i];
        const g = frame[i + 1];
        const b = frame[i + 2];
        if (
          r > 95 &&
          g > 40 &&
          b > 20 &&
          r > g &&
          r > b &&
          r - Math.min(g, b) > 15 &&
          Math.abs(r - g) > 15
        ) {
          skinCount++;
        }
        if (prev) {
          const d = r - prev[i];
          acc += d < 0 ? -d : d;
        }
      }
      const totalPixels = sampleSize * sampleSize;
      const skinRatio = skinCount / totalPixels;
      const nextFacePresent = skinRatio >= skinRatioThreshold;
      if (nextFacePresent !== lastFacePresentRef.current) {
        lastFacePresentRef.current = nextFacePresent;
        setFacePresent(nextFacePresent);
      }

      if (prev) {
        const meanDiff = acc / totalPixels;
        const raw = Math.max(0, Math.min(1, 1 - meanDiff / 30));
        const smoothed =
          stabilityRef.current * smoothing + raw * (1 - smoothing);
        stabilityRef.current = smoothed;

        // Quantise to 2 dp — avoids re-renders from sub-1% EMA drift.
        const rounded = Math.round(smoothed * 100) / 100;
        if (rounded !== lastStabilityRef.current) {
          lastStabilityRef.current = rounded;
          setStability(rounded);
        }

        const nextQuality: Quality =
          smoothed >= goodThreshold
            ? "good"
            : smoothed >= fairThreshold
              ? "fair"
              : "poor";
        if (nextQuality !== lastQualityRef.current) {
          lastQualityRef.current = nextQuality;
          setQuality(nextQuality);
        }
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
    skinRatioThreshold,
  ]);

  return { stability, quality, facePresent };
}
