"use client";

import React from "react";
import type { Quality } from "@/hooks/useFrameStability";

type Props = {
  quality: Quality;
  stability: number;
  label: string;
  hint: string;
};

const QUALITY_COPY: Record<Quality, string> = {
  idle: "Starting camera…",
  poor: "Hold still — align your face inside the guide",
  fair: "Almost there, keep steady",
  good: "Perfect — ready to capture",
};

const STROKE: Record<Quality, string> = {
  idle: "#52525b", // zinc-600
  poor: "#ef4444", // red-500
  fair: "#f59e0b", // amber-500
  good: "#10b981", // emerald-500
};

/**
 * Responsive SVG overlay that sits on top of the video feed. The guide
 * circle's stroke colour and pulse amplitude track the live stability
 * score so the user gets pre-capture feedback, not post-capture regret.
 */
export default function MouthGuide({ quality, stability, label, hint }: Props) {
  const stroke = STROKE[quality];
  // Circumference for the progress ring (r=46 in a 100 viewBox).
  const CIRC = 2 * Math.PI * 46;
  const progress = Math.max(0, Math.min(1, stability));

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="w-[78%] max-w-[340px] aspect-square drop-shadow-[0_0_24px_rgba(59,130,246,0.15)]"
        aria-hidden
      >
        <defs>
          <radialGradient id="mg-fade" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
          </radialGradient>
        </defs>

        {/* Vignette darkens outside the guide so the face pops. */}
        <rect x="0" y="0" width="100" height="100" fill="url(#mg-fade)" />

        {/* Base ring */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
        />

        {/* Stability ring — fills clockwise with the current score */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - progress)}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 120ms linear, stroke 200ms ease" }}
        />

        {/* Mouth silhouette — simplified jaw + bite indicator */}
        <g
          fill="none"
          stroke={stroke}
          strokeOpacity="0.55"
          strokeWidth="0.6"
          style={{ transition: "stroke 200ms ease" }}
        >
          <path d="M32 54 Q50 72 68 54" />
          <path d="M36 54 Q50 62 64 54" />
          <circle cx="50" cy="42" r="0.9" fill={stroke} />
        </g>

        {/* Corner ticks — classic camera framing cues */}
        <g
          stroke={stroke}
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          style={{ transition: "stroke 200ms ease" }}
        >
          <path d="M12 22 L12 14 L20 14" />
          <path d="M88 22 L88 14 L80 14" />
          <path d="M12 78 L12 86 L20 86" />
          <path d="M88 78 L88 86 L80 86" />
        </g>
      </svg>

      <div className="mt-5 px-4 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-white">{hint}</p>
        <p
          className="mt-2 text-xs font-medium transition-colors"
          style={{ color: stroke }}
        >
          {QUALITY_COPY[quality]}
        </p>
      </div>
    </div>
  );
}
