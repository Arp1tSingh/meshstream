import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonBase =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background,color,border-color,transform,opacity] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-lime text-[#0A0B0D] shadow-[inset_0_1px_0_rgba(255,255,255,.25)] hover:bg-[#d6ff57]",
  secondary:
    "border border-line bg-raised text-ink hover:border-line-strong hover:bg-[#1b2029]",
  ghost: "text-muted hover:bg-white/[0.055] hover:text-ink",
  danger: "bg-live text-white hover:bg-[#ff6b70]",
  outline:
    "border border-line-strong bg-transparent text-ink hover:border-lime/60 hover:text-lime",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-9 px-4 text-[13px]",
  lg: "h-11 px-5 text-[14px]",
  icon: "h-9 w-9",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(buttonBase, variants[variant], sizes[size], className);
}
