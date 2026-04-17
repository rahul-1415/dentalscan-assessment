"use client";

// [Task 01 — Scan Enhancement · R1: Visual Guidance Circle]
// MouthGuide renders a centred SVG ring overlay on top of the live camera feed.
// It gives patients a framing target so they position their mouth correctly,
// directly addressing the "too far / too close" problem described in the brief.
// React.memo ensures the component only re-renders when quality or stability
// actually change, keeping the media-feed overhead low. (Task 01 · R3 perf)

import React, { memo } from "react";
import type { Quality } from "@/hooks/useFrameStability";

type Props = {
  quality: Quality;
  stability: number;
  label: string;
  hint: string;
};

// [Task 01 · R2: Quality Indicator]
// Each quality state maps to a distinct colour so patients get immediate
// feedback: grey = waiting, red = poor/moving, amber = fair, green = good.
const STROKE: Record<Quality, string> = {
  idle: "#a1a1aa",
  poor: "#ef4444",
  fair: "#f59e0b",
  good: "#10b981",
};

// [Task 01 · R2: Quality Indicator — glow reinforcement]
// Drop-shadow filter on the SVG element amplifies the colour signal so the
// state change is readable even in bright outdoor light.
const GLOW: Record<Quality, string> = {
  idle: "none",
  poor: "drop-shadow(0 0 4px rgba(239,68,68,0.7))",
  fair: "drop-shadow(0 0 4px rgba(245,158,11,0.7))",
  good: "drop-shadow(0 0 6px rgba(16,185,129,0.85))",
};

const SEGMENTS = 48;

function MouthGuide({ quality, stability }: Props) {
  const stroke = STROKE[quality];
  const progress = Math.max(0, Math.min(1, stability));

  // [Task 01 · R2: Quality Indicator — progress ring]
  // `filled` translates the 0–1 stability score into a number of lit segments,
  // giving a continuous visual cue (like a loading ring) for how steady the
  // frame is — not just a binary pass/fail colour.
  const filled = Math.round(progress * SEGMENTS);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* [Task 01 · R1: Visual Guidance Circle — vignette]
          Radial gradient dims the corners while keeping the teeth-framing zone
          bright. Stops use min(vw, svh, px) so the clear area scales with the
          actual rendered ring size on every device, not just screen width. */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at center,
              transparent 0 min(33vw, 22svh, 140px),
              rgba(0,0,0,0.25) min(35vw, 24svh, 150px),
              rgba(0,0,0,0.65) min(45vw, 30svh, 194px),
              rgba(0,0,0,0.88) 100%)
          `,
        }}
      />

      {/* [Task 01 · R1: Visual Guidance Circle — ring, centred & responsive]
          w-[min(78vw,52svh,320px)] constrains by both viewport width AND height
          so the ring never overflows the camera area on landscape phones or
          small-screen devices. preserveAspectRatio keeps it perfectly centred. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="aspect-square w-[min(78vw,52svh,320px)]"
          style={{ filter: GLOW[quality], transition: "filter 300ms ease" }}
          aria-hidden
        >
          <defs>
            {/* Soft inner halo lifts the face out of the dark vignette */}
            <radialGradient id="mg-halo" cx="50%" cy="50%" r="50%">
              <stop offset="82%" stopColor="rgba(255,255,255,0)" />
              <stop offset="92%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
          </defs>

          <circle cx="50" cy="50" r="46" fill="url(#mg-halo)" />

          {/* Always-visible ghost ring — patients can see the target shape even
              before quality is evaluated (idle state). */}
          <circle
            cx="50"
            cy="50"
            r="46.5"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.5"
          />

          {/* [Task 01 · R2: Quality Indicator — segmented progress ticks]
              Lit ticks are longer and thicker than unlit ones so progress is
              readable in grayscale / low contrast. 180 ms CSS transitions
              prevent flickering from EMA float noise. */}
          <g style={{ transition: "stroke 200ms ease" }}>
            {Array.from({ length: SEGMENTS }).map((_, i) => {
              const angle = (i / SEGMENTS) * 2 * Math.PI - Math.PI / 2;
              const isOn = i < filled;
              const r1 = isOn ? 42.5 : 44.5;
              const r2 = isOn ? 50.5 : 48.5;
              const x1 = 50 + Math.cos(angle) * r1;
              const y1 = 50 + Math.sin(angle) * r1;
              const x2 = 50 + Math.cos(angle) * r2;
              const y2 = 50 + Math.sin(angle) * r2;
              return (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isOn ? stroke : "rgba(255,255,255,0.28)"}
                  strokeWidth={isOn ? 2 : 1.2}
                  strokeLinecap="round"
                  style={{ transition: "stroke 180ms ease, stroke-width 180ms ease" }}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

// [Task 01 · R3: Performance — React.memo]
// Wrapping in memo means MouthGuide only re-renders when `quality` or
// `stability` props change. The parent ScanningFlow re-renders more often
// (countdown ticks, camera state), so this prevents unnecessary SVG redraws
// on every tick and keeps the media feed smooth.
export default memo(MouthGuide);
