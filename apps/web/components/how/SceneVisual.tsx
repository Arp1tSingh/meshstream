"use client";

import { useReducedMotion } from "motion/react";

const ORIGIN = { x: 112, y: 228 };
const YOU = { x: 424, y: 226 };

const PEERS = [
  { id: "P1", x: 252, y: 112 },
  { id: "P2", x: 392, y: 82 },
  { id: "P3", x: 542, y: 142 },
  { id: "P4", x: 588, y: 262 },
  { id: "P5", x: 498, y: 368 },
  { id: "P6", x: 348, y: 382 },
  { id: "P7", x: 230, y: 322 },
];

const TREE_EDGES: Array<[string, string]> = [
  ["O", "P1"],
  ["O", "P7"],
  ["P1", "P2"],
  ["P1", "S"],
  ["P2", "P3"],
  ["P3", "P4"],
  ["P4", "P5"],
  ["P5", "P6"],
  ["P6", "P7"],
  ["S", "P5"],
];

function point(id: string) {
  if (id === "O") return ORIGIN;
  if (id === "S") return YOU;
  return PEERS.find((peer) => peer.id === id) ?? ORIGIN;
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, bend = 16) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - bend;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 680 440" className="h-full w-full" role="presentation">
      <defs>
        <pattern id="scene-grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
        </pattern>
        <filter id="scene-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="680" height="440" fill="url(#scene-grid)" />
      {children}
    </svg>
  );
}

function OriginNode({
  x = ORIGIN.x,
  y = ORIGIN.y,
  alert = false,
  shield = false,
}: {
  x?: number;
  y?: number;
  alert?: boolean;
  shield?: boolean;
}) {
  return (
    <g>
      {shield ? (
        <circle cx={x} cy={y} r="48" fill="none" stroke="#C9F73A" strokeOpacity="0.16" strokeDasharray="3 5" />
      ) : null}
      <rect x={x - 34} y={y - 34} width="68" height="68" rx="15" fill="#0D1015" stroke={alert ? "#7A3B3B" : "#3A4230"} />
      <path d={`M${x - 11} ${y + 10} L${x} ${y - 11} L${x + 11} ${y + 10} Z`} fill="none" stroke="#C9F73A" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx={x} cy={y - 11} r="2.8" fill="#C9F73A" />
      <text x={x} y={y + 52} textAnchor="middle" fill="#9AA1AE" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.14em">
        ORIGIN
      </text>
    </g>
  );
}

function PeerNode({
  x,
  y,
  label,
  failed = false,
  self = false,
}: {
  x: number;
  y: number;
  label: string;
  failed?: boolean;
  self?: boolean;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={self ? 22 : 15}
        fill={failed ? "#1A1012" : self ? "#141A0E" : "#0D1015"}
        stroke={failed ? "#FF5A5F" : self ? "#C9F73A" : "#323947"}
        strokeWidth={self ? 1.5 : 1}
        strokeDasharray={failed ? "3 3" : undefined}
      />
      <circle cx={x} cy={y} r={self ? 5 : 3.8} fill={failed ? "#FF5A5F" : self ? "#C9F73A" : "#5B6472"} />
      {failed ? (
        <g stroke="#FF5A5F" strokeWidth="1.4">
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} />
          <line x1={x + 5} y1={y - 5} x2={x - 5} y2={y + 5} />
        </g>
      ) : null}
      <text
        x={x}
        y={y + (self ? 38 : 30)}
        textAnchor="middle"
        fill={failed ? "#FF8A8E" : self ? "#C9F73A" : "#6A7280"}
        fontSize="8.5"
        fontFamily="var(--font-mono)"
        letterSpacing="0.1em"
      >
        {label}
      </text>
    </g>
  );
}

function Packet({
  path,
  delay,
  duration = "3s",
  color = "#D9FF66",
}: {
  path: string;
  delay: string;
  duration?: string;
  color?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <circle r="2.8" fill={color} filter="url(#scene-glow)">
      <animateMotion dur={duration} begin={delay} repeatCount="indefinite" path={path} />
      <animate attributeName="opacity" values="0;1;1;0" dur={duration} begin={delay} repeatCount="indefinite" />
    </circle>
  );
}

function Chip({
  x,
  y,
  children,
  tone = "neutral",
}: {
  x: number | string;
  y: number | string;
  children: string;
  tone?: "neutral" | "lime" | "danger";
}) {
  const px = Number(x);
  const py = Number(y);
  const color = tone === "lime" ? "#C9F73A" : tone === "danger" ? "#FF8A8E" : "#9AA1AE";
  const stroke = tone === "lime" ? "#3A4230" : tone === "danger" ? "#4A2528" : "#2A303B";
  return (
    <g fontFamily="var(--font-mono)" fontSize="8.5" letterSpacing="0.08em">
      <rect x={px} y={py} width={children.length * 6.2 + 24} height="22" rx="5" fill="#0A0C10" stroke={stroke} />
      <circle cx={px + 10} cy={py + 11} r="2.2" fill={color} />
      <text x={px + 18} y={py + 14} fill={color}>
        {children}
      </text>
    </g>
  );
}

function PublishScene() {
  return (
    <Frame>
      <g>
        <rect x="42" y="148" width="220" height="150" rx="14" fill="#0C0F14" stroke="#2A303B" />
        <rect x="58" y="164" width="188" height="106" rx="8" fill="#080A0D" stroke="#1E232C" />
        <circle cx="152" cy="216" r="26" fill="none" stroke="#323947" strokeWidth="1.5" />
        <circle cx="152" cy="216" r="11" fill="#1A1F28" stroke="#4A5361" />
        <circle cx="152" cy="216" r="4" fill="#C9F73A" />
        <rect x="86" y="282" width="64" height="4" rx="2" fill="#1E232C" />
        <rect x="86" y="282" width="46" height="4" rx="2" fill="#C9F73A" />
        <text x="58" y="140" fill="#6A7280" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.12em">
          BROWSER · CAM 01
        </text>
        <text x="58" y="316" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)">
          MIC ▮▮▮▮▯▯ · 720p30
        </text>
      </g>

      <path d={curve({ x: 262, y: 222 }, { x: 400, y: 228 }, 10)} fill="none" stroke="#C9F73A" strokeOpacity="0.45" strokeWidth="1.4" strokeDasharray="4 5" className="animate-dash" />
      <Packet path={curve({ x: 262, y: 222 }, { x: 400, y: 228 }, 10)} delay="0s" duration="2.4s" />
      <Packet path={curve({ x: 262, y: 222 }, { x: 400, y: 228 }, 10)} delay="1.2s" duration="2.4s" />

      <text x="292" y="200" fill="#C9F73A" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.12em">
        WHIP · ~120 ms
      </text>

      <OriginNode x={470} y={228} />

      <Chip x="42" y="366" tone="neutral">
        2.5 Mbps
      </Chip>
      <Chip x="156" y="366" tone="lime">
        H.264
      </Chip>
      <Chip x="248" y="366" tone="neutral">
        Opus 96k
      </Chip>
      <Chip x="464" y="366" tone="neutral">
        no transcode
      </Chip>
    </Frame>
  );
}

function SliceScene() {
  const parts = ["00:00", "00:01", "00:02", "00:03", "00:04", "00:05"];
  return (
    <Frame>
      <OriginNode x={92} y={96} />

      <path d="M 126 96 H 208" stroke="#323947" strokeWidth="1.2" strokeDasharray="3 4" />
      <rect x="208" y="74" width="390" height="44" rx="8" fill="#0C0F14" stroke="#323947" />
      <text x="224" y="100" fill="#6A7280" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">
        LIVE STREAM
      </text>
      <rect x="360" y="82" width="2" height="28" fill="#C9F73A" opacity="0.8" />
      <text x="372" y="100" fill="#C9F73A" fontSize="8" fontFamily="var(--font-mono)">
        NOW
      </text>

      <path d="M 403 118 V 164" stroke="#323947" strokeWidth="1" strokeDasharray="2 3" />
      <path d="M 208 140 L 620 140" stroke="#232833" strokeWidth="1" />

      {parts.map((label, index) => {
        const x = 86 + index * 94;
        const active = index === 3;
        return (
          <g key={label}>
            <path d={`M ${x + 40} 140 V ${176 + (index % 2) * 8}`} stroke="#2A303B" strokeWidth="1" strokeDasharray="2 3" />
            <rect
              x={x}
              y={188 + (index % 2) * 8}
              width="80"
              height="54"
              rx="7"
              fill={active ? "#141A0E" : "#0C0F14"}
              stroke={active ? "#C9F73A" : "#2A303B"}
              strokeOpacity={active ? 0.7 : 1}
            />
            <text x={x + 10} y={208 + (index % 2) * 8} fill={active ? "#C9F73A" : "#6A7280"} fontSize="8" fontFamily="var(--font-mono)">
              PART {String(index + 1).padStart(2, "0")}
            </text>
            <text x={x + 10} y={224 + (index % 2) * 8} fill="#9AA1AE" fontSize="8.5" fontFamily="var(--font-mono)">
              {label}
            </text>
            <text x={x + 10} y={236 + (index % 2) * 8} fill="#4F5866" fontSize="6.5" fontFamily="var(--font-mono)">
              sha256:8f2…
            </text>
            {active ? (
              <g>
                <circle cx={x + 66} cy={202 + (index % 2) * 8} r="7" fill="#C9F73A" />
                <path d={`M ${x + 62.5} ${202 + (index % 2) * 8} l 2.5 2.5 l 4 -5`} fill="none" stroke="#08090B" strokeWidth="1.2" />
              </g>
            ) : null}
          </g>
        );
      })}

      <text x="86" y="300" fill="#6A7280" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">
        400 ms PART · 1 s SEGMENT · fMP4
      </text>

      <g>
        <rect x="86" y="328" width="506" height="46" rx="8" fill="#0A0C10" stroke="#232833" />
        <text x="102" y="348" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.1em">
          EDGE MANIFEST
        </text>
        <text x="102" y="362" fill="#C9F73A" fontSize="8.5" fontFamily="var(--font-mono)">
          /live/8f2a/index.m3u8?t=…
        </text>
        <text x="420" y="356" fill="#9AA1AE" fontSize="8.5" fontFamily="var(--font-mono)">
          signed · 6 h
        </text>
      </g>
    </Frame>
  );
}

function TreeScene({ mode }: { mode: "swarm" | "relay" | "heal" | "fallback" }) {
  const failed = mode === "heal" ? "P2" : null;
  const reroute = mode === "heal";
  const fallback = mode === "fallback";

  return (
    <Frame>
      {TREE_EDGES.map(([from, to]) => {
        const a = point(from);
        const b = point(to);
        const isOrigin = from === "O";
        const touchesFailed = failed && (from === failed || to === failed);
        const active =
          mode === "relay"
            ? ["O-P1", "P1-S", "S-P5", "P5-P6", "P2-P3"].includes(`${from}-${to}`)
            : mode === "swarm"
              ? isOrigin
              : false;
        return (
          <path
            key={`${from}-${to}`}
            d={curve(a, b)}
            fill="none"
            stroke={touchesFailed ? "#FF5A5F" : active ? "#C9F73A" : isOrigin ? "#3E4A2A" : "#252B36"}
            strokeOpacity={touchesFailed ? 0.55 : active ? 0.5 : 1}
            strokeWidth={active ? 1.5 : 1}
            strokeDasharray={touchesFailed || active ? "4 5" : undefined}
            className={active && mode !== "swarm" ? "animate-dash" : undefined}
          />
        );
      })}

      {mode === "heal" ? (
        <path
          d={curve(point("P3"), point("S"), 60)}
          fill="none"
          stroke="#C9F73A"
          strokeWidth="1.5"
          strokeDasharray="4 5"
          className="animate-dash"
        />
      ) : null}

      {fallback ? (
        <path
          d={curve(ORIGIN, point("P6"), -90)}
          fill="none"
          stroke="#C9F73A"
          strokeWidth="1.5"
          strokeDasharray="4 5"
          className="animate-dash"
        />
      ) : null}

      {mode === "relay" ? (
        <>
          <Packet path={curve(point("O"), point("P1"))} delay="0s" duration="2.8s" />
          <Packet path={curve(point("P1"), point("S"))} delay="0.7s" duration="2.2s" />
          <Packet path={curve(point("S"), point("P5"))} delay="1.3s" duration="2.6s" />
          <Packet path={curve(point("P5"), point("P6"))} delay="0.4s" duration="2.4s" />
          <Packet path={curve(point("P2"), point("P3"))} delay="1.6s" duration="2.9s" />
        </>
      ) : null}

      {fallback ? (
        <>
          <Packet path={curve(ORIGIN, point("P6"), -90)} delay="0s" duration="3.4s" />
          <Packet path={curve(point("O"), point("P7"))} delay="0.8s" duration="2.8s" />
        </>
      ) : null}

      <OriginNode shield={fallback} />
      {PEERS.map((peer) => (
        <PeerNode
          key={peer.id}
          x={peer.x}
          y={peer.y}
          label={peer.id}
          failed={peer.id === failed}
          self={false}
        />
      ))}
      <PeerNode x={YOU.x} y={YOU.y} label="YOU" self />

      {mode === "swarm" ? (
        <>
          <Chip x="446" y="56" tone="lime">
            SWARM FORMING
          </Chip>
          <Chip x="446" y="86" tone="neutral">
            4 CHILDREN / PEER
          </Chip>
          <text x="86" y="404" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.1em">
            COORDINATOR ASSIGNS 1 PARENT · MAX DEPTH 4
          </text>
        </>
      ) : null}

      {mode === "relay" ? (
        <>
          <Chip x="442" y="56" tone="lime">
            68% OFFLOAD
          </Chip>
          <Chip x="442" y="86" tone="neutral">
            4.2 / 12 Mbps
          </Chip>
          <text x="86" y="404" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.1em">
            PEER PARTS FIRST · ORIGIN ONLY ON A MISS
          </text>
        </>
      ) : null}

      {mode === "heal" ? (
        <>
          <Chip x="428" y="56" tone="danger">
            P2 LEFT · RE-PARENT
          </Chip>
          <Chip x="428" y="86" tone="lime">
            RECOVERY &lt; 400 ms
          </Chip>
          <text x="86" y="404" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.1em">
            P3 RE-PARENTED TO YOU · ORIGIN COVERS THE GAP
          </text>
        </>
      ) : null}

      {mode === "fallback" ? (
        <>
          <Chip x="430" y="56" tone="lime">
            ORIGIN SAFETY NET
          </Chip>
          <Chip x="430" y="86" tone="neutral">
            SHA-256 VERIFIED
          </Chip>
          <text x="86" y="404" fill="#6A7280" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.1em">
            DEADLINE MISSED → FETCH FROM ORIGIN · NEVER STALL
          </text>
        </>
      ) : null}
    </Frame>
  );
}

export function SceneVisual({ scene }: { scene: number }) {
  if (scene === 0) return <PublishScene />;
  if (scene === 1) return <SliceScene />;
  if (scene === 2) return <TreeScene mode="swarm" />;
  if (scene === 3) return <TreeScene mode="relay" />;
  if (scene === 4) return <TreeScene mode="heal" />;
  return <TreeScene mode="fallback" />;
}
