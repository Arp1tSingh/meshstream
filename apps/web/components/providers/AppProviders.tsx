"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { GuestProvider } from "./GuestProvider";
import { ToastProvider } from "./ToastProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <ToastProvider>
        <GuestProvider>{children}</GuestProvider>
      </ToastProvider>
    </TooltipPrimitive.Provider>
  );
}
