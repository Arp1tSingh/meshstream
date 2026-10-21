"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonClass";

export { buttonClass };
export type { ButtonSize, ButtonVariant };

export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ className, variant = "primary", size = "md", ...props }, ref) {
  return <button ref={ref} className={buttonClass(variant, size, className)} {...props} />;
});

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "live" | "lime" | "warn" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-white/[0.035] text-muted",
    live: "border-live/30 bg-live/10 text-live-soft",
    lime: "border-lime/25 bg-lime/10 text-lime",
    warn: "border-warn/25 bg-warn/10 text-warn",
    info: "border-info/25 bg-info/10 text-info",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LiveBadge({ label = "Live" }: { label?: string }) {
  return (
    <Badge tone="live" className="pl-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-live" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
      </span>
      {label}
    </Badge>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-line bg-[#0A0C10] px-3 text-[13px] text-ink transition placeholder:text-faint hover:border-line-strong focus:border-lime/60 focus:outline-none focus:ring-2 focus:ring-lime/15",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full resize-none rounded-md border border-line bg-[#0A0C10] px-3 py-2.5 text-[13px] text-ink transition placeholder:text-faint hover:border-line-strong focus:border-lime/60 focus:outline-none focus:ring-2 focus:ring-lime/15",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="mono-label text-muted">
          {label}
        </label>
        {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  title,
  description,
  className,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-2xl focus:outline-none",
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-6">
          <div>
            <DialogPrimitive.Title className="font-display text-xl text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1.5 text-faint transition hover:bg-white/5 hover:text-ink">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-64 rounded-md border border-line-strong bg-[#151922] px-2.5 py-1.5 text-[11px] leading-snug text-ink shadow-xl"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[#151922]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5">
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-5 w-9 rounded-full border border-line-strong bg-[#0A0C10] transition data-[state=checked]:border-lime/40 data-[state=checked]:bg-lime/20 disabled:opacity-40"
      >
        <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 translate-x-[2px] rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-lime" />
      </SwitchPrimitive.Root>
      {label ? <span className="text-[12px] text-muted">{label}</span> : null}
    </label>
  );
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={(next) => onValueChange(next[0] ?? min)}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className="relative flex h-5 w-full touch-none select-none items-center"
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-lime" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-lime bg-void shadow-[0_0_0_4px_rgba(201,247,58,.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-lime" />
    </SliderPrimitive.Root>
  );
}

export function Avatar({
  name,
  color,
  size = 28,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  className?: string;
}) {
  const letters = name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-[#08090B]",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.max(9, size * 0.36),
      }}
      aria-hidden
    >
      {letters || "??"}
    </span>
  );
}

export function StatusDot({
  tone = "ok",
  pulse,
}: {
  tone?: "ok" | "warn" | "danger" | "idle";
  pulse?: boolean;
}) {
  const colors = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-live",
    idle: "bg-faint",
  } as const;
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse ? (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping-soft rounded-full",
            colors[tone],
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", colors[tone])} />
    </span>
  );
}

export function Sparkline({
  data,
  color = "#C9F73A",
  width = 120,
  height = 32,
  className,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const values = data.length > 1 ? data : [0, 0];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <path d={area} fill={color} opacity={0.07} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
      <circle
        cx={points[points.length - 1]?.[0] ?? width}
        cy={points[points.length - 1]?.[1] ?? height}
        r={2}
        fill={color}
      />
    </svg>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "lime" | "warn" | "danger";
  className?: string;
}) {
  const toneClass = {
    default: "text-ink",
    lime: "text-lime",
    warn: "text-warn",
    danger: "text-live-soft",
  } as const;
  return (
    <div className={cn("rounded-lg border border-line bg-[#0C0E13] p-3", className)}>
      <div className="mono-label mb-2">{label}</div>
      <div className={cn("metric text-[19px] leading-none", toneClass[tone])}>{value}</div>
      {sub ? <div className="mt-1.5 text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-[#0A0C10] px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-raised text-muted">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-6 bg-lime/50" />
      <span className="mono-label text-muted">{children}</span>
    </div>
  );
}
