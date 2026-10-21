"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

const nodes = [
  { id: "A", x: 272, y: 118 },
  { id: "B", x: 418, y: 92 },
  { id: "C", x: 566, y: 128 },
  { id: "D", x: 628, y: 246 },
  { id: "E", x: 548, y: 352 },
  { id: "F", x: 398, y: 376 },
  { id: "G", x: 264, y: 332 },
];

const origin = { x: 128, y: 228 };
const self = { x: 456, y: 226 };

const edges: Array<[string, string]> = [
  ["O", "A"],
  ["O", "G"],
  ["A", "B"],
  ["B", "C"],
  ["C", "S"],
  ["S", "D"],
  ["D", "E"],
  ["E", "F"],
  ["F", "G"],
  ["G", "S"],
  ["A", "S"],
  ["F", "S"],
];

const packets = [
  { from: origin, to: nodes[0]!, delay: "0s", duration: "3.2s" },
  { from: nodes[2]!, to: self, delay: "0.8s", duration: "2.8s" },
  { from: nodes[5]!, to: nodes[6]!, delay: "1.4s", duration: "3.6s" },
  { from: nodes[4]!, to: nodes[5]!, delay: "2.1s", duration: "3s" },
  { from: self, to: nodes[3]!, delay: "0.4s", duration: "3.4s" },
  { from: nodes[0]!, to: nodes[1]!, delay: "1.8s", duration: "2.6s" },
];

function position(id: string) {
  if (id === "O") return origin;
  if (id === "S") return self;
  return nodes.find((node) => node.id === id) ?? origin;
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2 - 18;
  return `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`;
}

function edgePath(from: string, to: string) {
  return curve(position(from), position(to));
}

export function MeshField({ className, compact = false }: { className?: string; compact?: boolean }) {
  const reduce = useReducedMotion();

  return (
    <div className={cn("relative h-full w-full", className)}>
      <svg
        viewBox="0 0 720 460"
        className="h-full w-full"
        role="img"
        aria-label="A live stream origin relaying video segments to a mesh of viewers"
      >
        <defs>
          <pattern id="mesh-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          </pattern>
          <radialGradient id="mesh-glow" cx="30%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#C9F73A" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#C9F73A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="edge-active" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#C9F73A" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#C9F73A" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#C9F73A" stopOpacity="0.15" />
          </linearGradient>
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="720" height="460" fill="url(#mesh-grid)" />
        <rect width="720" height="460" fill="url(#mesh-glow)" />

        {!reduce ? (
          <g opacity="0.7">
            {[0, 1, 2].map((index) => (
              <motion.circle
                key={index}
                cx={origin.x}
                cy={origin.y}
                r={34 + index * 22}
                fill="none"
                stroke="#C9F73A"
                strokeOpacity={0.16 - index * 0.04}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: [0.9, 1.15], opacity: [0.5, 0] }}
                transition={{
                  duration: 4,
                  delay: index * 1.2,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
                style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
              />
            ))}
          </g>
        ) : null}

        <g>
          {edges.map(([from, to]) => {
            const active = ["O-A", "C-S", "G-S", "F-S", "S-D"].includes(`${from}-${to}`);
            return (
              <path
                key={`${from}-${to}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={active ? "url(#edge-active)" : "#252B36"}
                strokeWidth={active ? 1.4 : 1}
                strokeDasharray={active ? "4 5" : undefined}
                className={active && !reduce ? "animate-dash" : undefined}
              />
            );
          })}
        </g>

        {!reduce
          ? packets.map((packet, index) => {
              const path = curve(packet.from, packet.to);
              return (
                <circle key={index} r="2.6" fill="#D9FF66" filter="url(#node-glow)">
                  <animateMotion
                    dur={packet.duration}
                    begin={packet.delay}
                    repeatCount="indefinite"
                    path={path}
                  />
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    dur={packet.duration}
                    begin={packet.delay}
                    repeatCount="indefinite"
                  />
                </circle>
              );
            })
          : null}

        <g>
          {nodes.map((node, index) => (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r="17" fill="#0D1015" stroke="#2C333F" />
              <circle cx={node.x} cy={node.y} r="5" fill="#5B6472" />
              <text
                x={node.x}
                y={node.y + 32}
                textAnchor="middle"
                fill="#6A7280"
                fontSize="9"
                fontFamily="var(--font-mono)"
                letterSpacing="0.08em"
              >
                P{String(index + 1).padStart(2, "0")}
              </text>
            </g>
          ))}
        </g>

        <g>
          <rect
            x={origin.x - 30}
            y={origin.y - 30}
            width="60"
            height="60"
            rx="14"
            fill="#0E1116"
            stroke="#3A4230"
          />
          <path
            d={`M${origin.x - 10} ${origin.y + 9} L${origin.x} ${origin.y - 10} L${origin.x + 10} ${origin.y + 9} Z`}
            fill="none"
            stroke="#C9F73A"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx={origin.x} cy={origin.y - 10} r="2.6" fill="#C9F73A" />
          <text
            x={origin.x}
            y={origin.y + 44}
            textAnchor="middle"
            fill="#9AA1AE"
            fontSize="9"
            fontFamily="var(--font-mono)"
            letterSpacing="0.14em"
          >
            ORIGIN
          </text>
        </g>

        <g>
          <circle cx={self.x} cy={self.y} r="23" fill="#151B10" stroke="#C9F73A" strokeWidth="1.5" />
          <circle cx={self.x} cy={self.y} r="6" fill="#C9F73A" />
          <text
            x={self.x}
            y={self.y + 38}
            textAnchor="middle"
            fill="#C9F73A"
            fontSize="9"
            fontFamily="var(--font-mono)"
            letterSpacing="0.14em"
          >
            YOU
          </text>
        </g>

        {!compact ? (
          <g fontFamily="var(--font-mono)" fontSize="9" letterSpacing="0.08em">
            <rect x="540" y="54" width="112" height="24" rx="6" fill="#0B0D11" stroke="#232833" />
            <circle cx="554" cy="66" r="3" fill="#C9F73A" />
            <text x="563" y="69" fill="#9AA1AE">
              68% PEER
            </text>
            <rect x="62" y="330" width="126" height="24" rx="6" fill="#0B0D11" stroke="#232833" />
            <text x="74" y="346" fill="#6A7280">
              4.2 / 12 Mbps
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
