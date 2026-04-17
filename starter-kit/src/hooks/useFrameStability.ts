"use client";

// [Task 01 — Scan Enhancement · R2: Quality Indicator + R3: Performance]
// useFrameStability drives the MouthGuide ring colour and the auto-capture
// countdown without any ML model or external API — pure browser canvas maths.
//
// Two signals are produced:
//   • stability (0–1): how much the frame is moving (inter-frame pixel diff)
//   • quality ("idle"|"poor"|"fair"|"good"): quantised stability bucket
//   • facePresent (bool): Kovac RGB skin-tone gate — prevents the ring going
//     green when the camera faces a wall or ceiling (no face = no capture)
//
// Performance design (R3):
//   • 64×64 sample canvas — ~16 KB memory, a few hundred µs CPU per tick
//   • 120 ms sample interval — well below the human perception threshold
//   • Change-detection refs gate every setState call so React only schedules
//     a re-render when a value actually changes, not on every RAF tick
//   • Stability quantised to 2 dp to suppress EMA float drift re-renders

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

export function useFrameStability(
  videoRef: RefObject<HTMLVideoElement>,
  active: boolean,
  opts: Options = {},
) {
  const {
    sampleSize = 64,
    sampleIntervalMs = 120,   // [R3] throttle: sample every 120 ms, not every frame
    smoothing = 0.75,          // [R2] EMA weight — dampens jitter in the quality signal
    goodThreshold = 0.9,       // [R2] tuned: high bar so green = truly stable
    fairThreshold = 0.55,
    // [R2 — face-presence gate]
    // Fraction of the 64×64 sample that must pass the skin heuristic.
    // 12% is generous for a face at arm's length but rejects ceilings/desks.
    skinRatioThreshold = 0.12,
  } = opts;

  const [stability, setStability] = useState(0);
  const [quality, setQuality] = useState<Quality>("idle");
  const [facePresent, setFacePresent] = useState(false);
  const stabilityRef = useRef(0);

  // [R3: Performance — change-detection refs]
  // Storing the last-committed value in a ref lets us skip setState entirely
  // when nothing changed, avoiding React reconciliation on every 120 ms tick.
  const lastQualityRef = useRef<Quality>("idle");
  const lastFacePresentRef = useRef(false);
  const lastStabilityRef = useRef(0);

  useEffect(() => {
    if (!active) {
      // Reset all signals when camera is not active (e.g. after all captures done)
      setQuality("idle");
      setStability(0);
      setFacePresent(false);
      stabilityRef.current = 0;
      lastQualityRef.current = "idle";
      lastFacePresentRef.current = false;
      lastStabilityRef.current = 0;
      return;
    }

    // [R3: Performance — tiny off-screen canvas]
    // Drawing to a 64×64 canvas instead of the full video resolution keeps
    // getImageData cost negligible (~16 KB vs several MB for 1080p).
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

      // [R3: Performance — throttle via timestamp]
      // Skip frames that arrive sooner than sampleIntervalMs to stay on the
      // RAF loop without burning CPU every 16 ms.
      if (t - lastSampleAt < sampleIntervalMs) return;
      lastSampleAt = t;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      ctx.drawImage(video, 0, 0, sampleSize, sampleSize);
      const frame = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

      // [R2: Quality Indicator — Kovac RGB skin-tone gate]
      // Simple daylight-rule heuristic (Kovac et al.) that counts pixels
      // matching a human skin tone range. No ML — runs in a single pass over
      // the pixel buffer we already read for the stability diff, so zero extra
      // cost. Prevents the ring going green when the user faces a plain wall.
      let skinCount = 0;
      let acc = 0;
      for (let i = 0; i < frame.length; i += 4) {
        const r = frame[i];
        const g = frame[i + 1];
        const b = frame[i + 2];
        if (
          r > 95 && g > 40 && b > 20 &&
          r > g && r > b &&
          r - Math.min(g, b) > 15 &&
          Math.abs(r - g) > 15
        ) {
          skinCount++;
        }
        // Accumulate inter-frame red-channel diff for stability measurement
        if (prev) {
          const d = r - prev[i];
          acc += d < 0 ? -d : d;
        }
      }

      const totalPixels = sampleSize * sampleSize;
      const skinRatio = skinCount / totalPixels;
      const nextFacePresent = skinRatio >= skinRatioThreshold;

      // [R3: Performance — change-detection ref for facePresent]
      if (nextFacePresent !== lastFacePresentRef.current) {
        lastFacePresentRef.current = nextFacePresent;
        setFacePresent(nextFacePresent);
      }

      if (prev) {
        // [R2: Quality Indicator — EMA-smoothed stability score]
        // meanDiff is normalised against 30 (empirical max for a still hand-held
        // phone). Exponential moving average with smoothing=0.75 damps jitter
        // so the ring colour doesn't flicker on sub-threshold wobble.
        const meanDiff = acc / totalPixels;
        const raw = Math.max(0, Math.min(1, 1 - meanDiff / 30));
        const smoothed = stabilityRef.current * smoothing + raw * (1 - smoothing);
        stabilityRef.current = smoothed;

        // [R3: Performance — quantise to 2 dp]
        // Rounds to 2 decimal places before calling setStability so tiny EMA
        // drift (e.g. 0.9001 → 0.9002) does not trigger a React re-render.
        const rounded = Math.round(smoothed * 100) / 100;
        if (rounded !== lastStabilityRef.current) {
          lastStabilityRef.current = rounded;
          setStability(rounded);
        }

        // [R2: Quality Indicator — quality bucket, change-gated]
        const nextQuality: Quality =
          smoothed >= goodThreshold ? "good"
          : smoothed >= fairThreshold ? "fair"
          : "poor";
        if (nextQuality !== lastQualityRef.current) {
          lastQualityRef.current = nextQuality;
          setQuality(nextQuality);
        }
      }

      // Copy frame into a new buffer — ImageData.data is a live view that
      // gets overwritten on the next drawImage call.
      prev = new Uint8ClampedArray(frame);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, videoRef, sampleSize, sampleIntervalMs, smoothing, goodThreshold, fairThreshold, skinRatioThreshold]);

  return { stability, quality, facePresent };
}
