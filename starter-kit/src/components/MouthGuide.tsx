"use client";

import React, { memo } from "react";
import type { Quality } from "@/hooks/useFrameStability";

type Props = {
  quality: Quality;
  stability: number;
  label: string;
  hint: string;
};

const STROKE: Record<Quality, string> = {
  idle: "#52525b",
  poor: "#ef4444",
  fair: "#f59e0b",
  good: "#10b981",
};

const SEGMENTS = 48;

function MouthGuide({ quality, stability }: Props) {
  const stroke = STROKE[quality];
  const progress = Math.max(0, Math.min(1, stability));
  const filled = Math.round(progress * SEGMENTS);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Layered vignette — transparent at center, soft mid-dim near the
          ring edge, deeper at the corners. Gives a sense of depth instead
          of a hard donut cutout. */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at center,
              transparent 0 min(36vw, 156px),
              rgba(0,0,0,0.35) min(38vw, 164px),
              rgba(0,0,0,0.72) min(48vw, 210px),
              rgba(0,0,0,0.9) 100%)
          `,
        }}
      />

      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="aspect-square w-[78vw] max-w-[340px]"
          aria-hidden
        >
          <defs>
            {/* Inner halo — a faint white glow just inside the ring so the
                face feels lit rather than boxed in. */}
            <radialGradient id="mg-halo" cx="50%" cy="50%" r="50%">
              <stop offset="82%" stopColor="rgba(255,255,255,0)" />
              <stop offset="92%" stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
          </defs>

          <circle cx="50" cy="50" r="46" fill="url(#mg-halo)" />

          {/* Progress-driven segmented ring — lit ticks are longer AND
              brighter than unlit, so progress is readable even at a glance
              in grayscale / low-contrast viewing. */}
          <g style={{ transition: "stroke 200ms ease" }}>
            {Array.from({ length: SEGMENTS }).map((_, i) => {
              const angle = (i / SEGMENTS) * 2 * Math.PI - Math.PI / 2;
              const isOn = i < filled;
              // Lit ticks extend further inward and outward than unlit ones.
              const r1 = isOn ? 43.5 : 45.5;
              const r2 = isOn ? 50 : 48;
              const x1 = 50 + Math.cos(angle) * r1;
              const y1 = 50 + Math.sin(angle) * r1;
              const x2 = 50 + Math.cos(angle) * r2;
              const y2 = 50 + Math.sin(angle) * r2;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isOn ? stroke : "rgba(255,255,255,0.15)"}
                  strokeWidth={isOn ? 1.8 : 1.1}
                  strokeLinecap="round"
                  style={{
                    transition:
                      "stroke 180ms ease, stroke-width 180ms ease",
                  }}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

export default memo(MouthGuide);
