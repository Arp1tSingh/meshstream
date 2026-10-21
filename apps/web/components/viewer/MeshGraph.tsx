"use client";

import { useReducedMotion } from "motion/react";
import type { SwarmStats } from "@meshstream/protocol";
import type { SwarmPeerInfo } from "@meshstream/swarm";
import { cn } from "@/lib/cn";

const ORIGIN = { x: 84, y: 160 };
const SELF = { x: 342, y: 160 };

function peerPositions(count: number) {
  const visible = Math.min(count, 8);
  return Array.from({ length: visible }, (_, index) => {
    const angle = (-78 + (156 / Math.max(1, visible - 1)) * index) * (Math.PI / 180);
    const radiusX = 208;
    const radiusY = 132;
    return {
      x: SELF.x + Math.cos(angle) * radiusX,
      y: SELF.y + Math.sin(angle) * radiusY,
    };
  });
}

export function MeshGraph({
  peers,
  status,
  offload,
  className,
}: {
  peers: SwarmPeerInfo[];
  status: SwarmStats["status"];
  offload: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const positions = peerPositions(peers.length);
  const connected = peers.filter((peer) => peer.connected);
  const visiblePeers = connected.slice(0, 8);
  const hidden = connected.length - visiblePeers.length;

  return (
    <div className={cn("relative h-full w-full", className)}>
      <svg
        viewBox="0 0 680 320"
        className="h-full w-full"
        role="img"
        aria-label={`Local swarm view: ${connected.length} direct peers, ${Math.round(offload * 100)} percent peer traffic`}
      >
        <defs>
          <pattern id="swarm-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          </pattern>
          <filter id="swarm-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="680" height="320" fill="url(#swarm-grid)" />

        <path
          d={`M ${ORIGIN.x + 22} ${ORIGIN.y} C 190 ${ORIGIN.y - 28}, 240 ${SELF.y + 26}, ${SELF.x - 22} ${SELF.y}`}
          fill="none"
          stroke="#3E4A2A"
          strokeWidth="1.2"
          strokeDasharray="4 5"
          className={reduce ? undefined : "animate-dash"}
        />
        <text x="204" y="138" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
          ORIGIN PATH
        </text>

        {positions.slice(0, visiblePeers.length).map((position, index) => {
          const peer = visiblePeers[index]!;
          const color = peer.direction === "up" ? "#5B9DFF" : "#C9F73A";
          const path = `M ${SELF.x + 22} ${SELF.y} C ${SELF.x + 70} ${SELF.y}, ${position.x - 70} ${position.y}, ${position.x - 16} ${position.y}`;
          return (
            <g key={peer.id}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeOpacity="0.32"
                strokeWidth="1.2"
              />
              {!reduce ? (
                <circle r="2.2" fill={color} filter="url(#swarm-glow)">
                  <animateMotion
                    dur={`${2.4 + (index % 3) * 0.5}s`}
                    begin={`${index * 0.3}s`}
                    repeatCount="indefinite"
                    path={path}
                  />
                </circle>
              ) : null}
              <circle
                cx={position.x}
                cy={position.y}
                r="15"
                fill="#0D1015"
                stroke={color}
                strokeOpacity="0.55"
              />
              <circle cx={position.x} cy={position.y} r="3.8" fill={color} />
              <text
                x={position.x}
                y={position.y + 29}
                textAnchor="middle"
                fill="#6A7280"
                fontSize="8"
                fontFamily="var(--font-mono)"
                letterSpacing="0.1em"
              >
                {peer.id.slice(0, 4).toUpperCase()}
              </text>
            </g>
          );
        })}

        <g>
          <rect x={ORIGIN.x - 24} y={ORIGIN.y - 24} width="48" height="48" rx="11" fill="#0D1015" stroke="#3A4230" />
          <path
            d={`M${ORIGIN.x - 8} ${ORIGIN.y + 7} L${ORIGIN.x} ${ORIGIN.y - 8} L${ORIGIN.x + 8} ${ORIGIN.y + 7} Z`}
            fill="none"
            stroke="#C9F73A"
            strokeWidth="1.4"
          />
          <circle cx={ORIGIN.x} cy={ORIGIN.y - 8} r="2.1" fill="#C9F73A" />
          <text x={ORIGIN.x} y={ORIGIN.y + 40} textAnchor="middle" fill="#9AA1AE" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
            ORIGIN
          </text>
        </g>

        <g>
          <circle cx={SELF.x} cy={SELF.y} r="25" fill="#141A0E" stroke="#C9F73A" strokeWidth="1.5" />
          <circle cx={SELF.x} cy={SELF.y} r="5.5" fill="#C9F73A" />
          <text x={SELF.x} y={SELF.y + 42} textAnchor="middle" fill="#C9F73A" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.14em">
            YOU
          </text>
        </g>

        {connected.length === 0 ? (
          <g>
            <rect x="420" y="52" width="188" height="28" rx="6" fill="#0A0C10" stroke="#2A303B" />
            <circle cx="436" cy="66" r="2.6" fill="#FFB020" />
            <text x="446" y="69" fill="#9AA1AE" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.06em">
              {status === "offline" ? "SIGNAL OFFLINE" : "ORIGIN ONLY"}
            </text>
          </g>
        ) : null}

        {hidden > 0 ? (
          <g>
            <rect x="520" y="252" width="94" height="24" rx="6" fill="#0A0C10" stroke="#2A303B" />
            <text x="532" y="268" fill="#9AA1AE" fontSize="8.5" fontFamily="var(--font-mono)">
              +{hidden} PEERS
            </text>
          </g>
        ) : null}

        <g fontFamily="var(--font-mono)" fontSize="8" letterSpacing="0.1em">
          <circle cx="546" cy="52" r="2.4" fill="#C9F73A" />
          <text x="554" y="55" fill="#6A7280">
            DOWNLINK
          </text>
          <circle cx="546" cy="68" r="2.4" fill="#5B9DFF" />
          <text x="554" y="71" fill="#6A7280">
            UPLINK
          </text>
        </g>
      </svg>

      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 rounded-md border border-line bg-[#0A0C10]/90 px-2.5 py-1.5 backdrop-blur">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected.length > 0 ? "bg-lime" : status === "offline" ? "bg-live" : "bg-warn",
          )}
        />
        <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">
          Local swarm view
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-4 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
        {Math.round(offload * 100)}% via peers
      </div>
    </div>
  );
}
