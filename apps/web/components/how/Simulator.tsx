"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Skull, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  MetricTile,
  Slider,
  Switch,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";

const ORIGIN = { x: 58, y: 184 };
const LEVEL_X = [0, 170, 300, 430, 552];

interface TreeNode {
  id: number;
  parent: number;
  depth: number;
  x: number;
  y: number;
  failed: boolean;
}

function buildTree(
  count: number,
  p2p: boolean,
  slow: boolean,
  failed: Set<number>,
): TreeNode[] {
  const peerCapacity = slow ? 1 : 3;
  const originCapacity = slow ? 2 : 3;
  const capacity = new Map<number, number>();
  capacity.set(-1, p2p ? originCapacity : count);
  const parents: number[] = [];
  const depths: number[] = [];

  for (let index = 0; index < count; index += 1) {
    let parent = -1;
    if (p2p) {
      if ((capacity.get(-1) ?? 0) > 0) {
        parent = -1;
      } else {
        parent = -1;
        for (let candidate = 0; candidate < index; candidate += 1) {
          if (failed.has(candidate)) continue;
          if (depths[candidate]! >= 4) continue;
          if ((capacity.get(candidate) ?? 0) > 0) {
            parent = candidate;
            break;
          }
        }
      }
      capacity.set(parent, (capacity.get(parent) ?? 0) - 1);
    }
    parents[index] = parent;
    depths[index] = parent === -1 ? 1 : Math.min(4, depths[parent]! + 1);
  }

  const levels = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const depth = depths[index]!;
    const group = levels.get(depth) ?? [];
    group.push(index);
    levels.set(depth, group);
  }

  const nodes: TreeNode[] = [];
  for (const [depth, ids] of levels) {
    ids.forEach((id, row) => {
      const spacing = Math.min(38, 300 / Math.max(1, ids.length - 1));
      nodes.push({
        id,
        parent: parents[id]!,
        depth,
        x: LEVEL_X[depth] ?? 552,
        y: 184 + (row - (ids.length - 1) / 2) * spacing,
        failed: failed.has(id),
      });
    });
  }
  return nodes.sort((a, b) => a.id - b.id);
}

function randomHealthyPeer(count: number, failed: Set<number>) {
  const candidates = Array.from({ length: count }, (_, index) => index).filter(
    (index) => !failed.has(index),
  );
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export function Simulator() {
  const [viewers, setViewers] = useState(18);
  const [p2p, setP2p] = useState(true);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [lastKilled, setLastKilled] = useState<number | null>(null);

  const nodes = useMemo(
    () => buildTree(viewers, p2p, slow, failed),
    [viewers, p2p, slow, failed],
  );

  const originChildren = nodes.filter((node) => node.parent === -1).length;
  const originMbps = originChildren * 2.5;
  const offload = viewers > 0 ? Math.max(0, (viewers - originChildren) / viewers) : 0;
  const healthy = nodes.filter((node) => !node.failed).length;
  const risk =
    originMbps > 12 ? "High" : originMbps > 9 ? "Elevated" : slow && offload < 0.4 ? "Elevated" : "Low";
  const riskTone = risk === "High" ? "danger" : risk === "Elevated" ? "warn" : "lime";

  function killRandom() {
    const victim = randomHealthyPeer(viewers, failed);
    if (victim === null) return;
    setFailed((current) => new Set(current).add(victim));
    setLastKilled(victim);
  }

  function reset() {
    setFailed(new Set());
    setLastKilled(null);
    setViewers(18);
    setP2p(true);
    setSlow(false);
  }

  return (
    <div className="panel noise overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-lime/25 bg-lime/10 text-lime">
            <TriangleAlert className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="mono-label text-lime/70">Interactive model</div>
            <div className="text-[13px] font-medium text-ink">Swarm simulator</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={p2p ? "lime" : "neutral"}>{p2p ? "P2P enabled" : "Origin only"}</Badge>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[268px_1fr]">
        <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="mono-label text-muted">Viewers</span>
                <span className="metric text-[14px] text-ink">{viewers}</span>
              </div>
              <Slider
                value={viewers}
                onValueChange={(value) => {
                  setViewers(value);
                  setFailed((current) => {
                    const next = new Set([...current].filter((index) => index < value));
                    return next;
                  });
                }}
                min={2}
                max={50}
                ariaLabel="Number of viewers"
              />
              <div className="mt-1 flex justify-between font-mono text-[9px] text-faint">
                <span>2</span>
                <span>50</span>
              </div>
            </div>

            <div className="space-y-3 border-t border-line pt-4">
              <Switch checked={p2p} onCheckedChange={setP2p} label="Peer-assisted delivery" />
              <Switch checked={slow} onCheckedChange={setSlow} label="Slow uplink (1 child / peer)" />
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={killRandom}
                disabled={!p2p || healthy === 0}
              >
                <Skull className="h-3.5 w-3.5" />
                Kill a random peer
              </Button>
              <p className="text-[10.5px] leading-relaxed text-faint">
                Click any peer in the graph to disconnect it. The coordinator re-parents its
                children on the next tick.
              </p>
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <div className="flex items-center gap-2 text-[10.5px] text-faint">
                <span className="h-2 w-2 rounded-full bg-lime" />
                Peer link
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-faint">
                <span className="h-2 w-2 rounded-full bg-warn" />
                Origin seed
              </div>
              <div className="flex items-center gap-2 text-[10.5px] text-faint">
                <span className="h-2 w-2 rounded-full bg-live" />
                Failed peer
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="grid-lines absolute inset-0 opacity-50" />
          <svg
            viewBox="0 0 640 368"
            className="relative w-full"
            role="img"
            aria-label={`Swarm graph with ${viewers} viewers and ${originChildren} origin seeds`}
          >
            <defs>
              <filter id="sim-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {nodes.map((node) => {
              const parent = node.parent === -1 ? ORIGIN : nodes[node.parent];
              if (!parent) return null;
              const isOrigin = node.parent === -1;
              return (
                <line
                  key={`edge-${node.id}`}
                  x1={parent.x}
                  y1={parent.y}
                  x2={node.x}
                  y2={node.y}
                  stroke={node.failed ? "#FF5A5F" : isOrigin ? "#FFB020" : "#C9F73A"}
                  strokeOpacity={node.failed ? 0.28 : isOrigin ? 0.35 : 0.22}
                  strokeWidth={1}
                  strokeDasharray={isOrigin ? "3 4" : undefined}
                />
              );
            })}

            {nodes.slice(0, 10).map((node) => {
              const parent = node.parent === -1 ? ORIGIN : nodes[node.parent];
              if (!parent || node.failed || node.parent === -1) return null;
              return (
                <circle key={`packet-${node.id}`} r="1.8" fill="#D9FF66" filter="url(#sim-glow)">
                  <animateMotion
                    dur={`${2.4 + (node.id % 4) * 0.4}s`}
                    begin={`${(node.id % 5) * 0.35}s`}
                    repeatCount="indefinite"
                    path={`M ${parent.x} ${parent.y} L ${node.x} ${node.y}`}
                  />
                </circle>
              );
            })}

            <g>
              <circle cx={ORIGIN.x} cy={ORIGIN.y} r="25" fill="#141A0E" stroke="#C9F73A" strokeWidth="1.4" />
              <path
                d={`M${ORIGIN.x - 8} ${ORIGIN.y + 7} L${ORIGIN.x} ${ORIGIN.y - 8} L${ORIGIN.x + 8} ${ORIGIN.y + 7} Z`}
                fill="none"
                stroke="#C9F73A"
                strokeWidth="1.3"
              />
              <circle cx={ORIGIN.x} cy={ORIGIN.y - 8} r="2.1" fill="#C9F73A" />
              <text
                x={ORIGIN.x}
                y={ORIGIN.y + 40}
                textAnchor="middle"
                fill="#C9F73A"
                fontSize="8.5"
                fontFamily="var(--font-mono)"
                letterSpacing="0.12em"
              >
                ORIGIN
              </text>
            </g>

            {nodes.map((node) => {
              const killed = lastKilled === node.id && node.failed;
              return (
                <g
                  key={`node-${node.id}`}
                  onClick={() => {
                    if (!p2p) return;
                    setFailed((current) => {
                      const next = new Set(current);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    });
                    setLastKilled(node.id);
                  }}
                  className={cn(p2p ? "cursor-pointer" : "cursor-default")}
                >
                  <title>{`Viewer ${node.id + 1} · ${node.failed ? "failed" : "healthy"}`}</title>
                  {node.failed ? (
                    <circle cx={node.x} cy={node.y} r="10" fill="#FF5A5F" opacity="0.12" />
                  ) : null}
                  {killed ? (
                    <circle cx={node.x} cy={node.y} r="12" fill="none" stroke="#FF5A5F" opacity="0.4" />
                  ) : null}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="5.2"
                    fill={node.failed ? "#1A1012" : "#0D1015"}
                    stroke={node.failed ? "#FF5A5F" : "#4A5361"}
                    strokeWidth="1"
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="1.9"
                    fill={node.failed ? "#FF5A5F" : "#C9F73A"}
                  />
                </g>
              );
            })}

            <text x="18" y="22" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
              ORIGIN
            </text>
            <text x="170" y="22" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
              DEPTH 1
            </text>
            <text x="300" y="22" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
              DEPTH 2
            </text>
            <text x="430" y="22" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
              DEPTH 3
            </text>
            <text x="552" y="22" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.12em">
              DEPTH 4
            </text>
          </svg>

          <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-line bg-[#0A0C10]/90 px-2.5 py-1.5 font-mono text-[9px] text-faint backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            {healthy} healthy peers
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
        <div className="bg-[#0C0E13] p-4">
          <div className="mono-label mb-2">Origin egress</div>
          <div className="metric text-[20px] text-ink">
            {originMbps.toFixed(1)}
            <span className="ml-1 text-[10px] text-faint">Mbps</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                originMbps > 12 ? "bg-live" : originMbps > 9 ? "bg-warn" : "bg-lime",
              )}
              style={{ width: `${Math.min(100, (originMbps / 12) * 100)}%` }}
            />
          </div>
        </div>
        <div className="bg-[#0C0E13] p-4">
          <div className="mono-label mb-2">Peer offload</div>
          <div className="metric text-[20px] text-lime">{(offload * 100).toFixed(0)}%</div>
          <div className="mt-2 text-[10px] text-faint">
            {viewers - originChildren} of {viewers} viewers served by peers
          </div>
        </div>
        <div className="bg-[#0C0E13] p-4">
          <div className="mono-label mb-2">Origin seeds</div>
          <div className="metric text-[20px] text-ink">{originChildren}</div>
          <div className="mt-2 text-[10px] text-faint">Budget: 3 roots · 4.8 Mbps cap</div>
        </div>
        <div className="bg-[#0C0E13] p-4">
          <div className="mono-label mb-2">Rebuffer risk</div>
          <div
            className={cn(
              "metric text-[20px]",
              risk === "High" ? "text-live-soft" : risk === "Elevated" ? "text-warn" : "text-ok",
            )}
          >
            {risk}
          </div>
          <div className="mt-2 text-[10px] text-faint">
            {risk === "High"
              ? "Origin over budget — add peers or lower quality"
              : "Modeled on the 12 Mbps guard"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
          Model, not live telemetry
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
          720p · 2.5 Mbps per stream
        </span>
      </div>
    </div>
  );
}
