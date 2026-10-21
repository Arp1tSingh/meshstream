"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Guest } from "@meshstream/protocol";
import { GUEST_COLORS } from "@meshstream/protocol";
import { api } from "@/lib/api";
import { useToast } from "./ToastProvider";
import { Avatar, Button, Dialog, DialogContent, Field, Input } from "@/components/ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface GuestContextValue {
  guest: Guest | null;
  loading: boolean;
  error: string | null;
  openProfile: () => void;
  refresh: () => Promise<void>;
}

const GuestContext = createContext<GuestContextValue | null>(null);

export function useGuest() {
  const context = useContext(GuestContext);
  if (!context) throw new Error("useGuest must be used inside GuestProvider");
  return context;
}

export function GuestProvider({ children }: { children: ReactNode }) {
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await api<Guest>("/api/guest");
      setGuest(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guest session unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openProfile = useCallback(() => setOpen(true), []);
  const value = useMemo(
    () => ({ guest, loading, error, openProfile, refresh }),
    [guest, loading, error, openProfile, refresh],
  );

  return (
    <GuestContext.Provider value={value}>
      {children}
      <ProfileDialog
        open={open}
        onOpenChange={setOpen}
        guest={guest}
        error={error}
        onSaved={(updated) => {
          setGuest(updated);
          setError(null);
          toast("Guest profile updated", { tone: "success" });
        }}
      />
    </GuestContext.Provider>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  guest,
  error,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guest: Guest | null;
  error: string | null;
  onSaved: (guest: Guest) => void;
}) {
  const [name, setName] = useState(guest?.displayName ?? "");
  const [color, setColor] = useState(guest?.color ?? GUEST_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(guest?.displayName ?? "");
      setColor(guest?.color ?? GUEST_COLORS[0]);
      setSaveError(null);
    }
  }, [open, guest]);

  async function save() {
    if (!guest) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api<Guest>("/api/guest", {
        method: "PATCH",
        body: JSON.stringify({ displayName: name.trim(), color }),
      });
      onSaved(updated);
      onOpenChange(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Your guest profile"
        description="No account, no email. This name and color live on this device and are used for chat and your stream."
      >
        {!guest ? (
          <div className="rounded-md border border-warn/25 bg-warn/5 p-3 text-[12px] text-warn">
            {error ?? "Creating your guest session…"}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-[#0A0C10] p-3">
              <Avatar name={name || guest.displayName} color={color} size={38} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">
                  {name || guest.displayName}
                </div>
                <div className="text-[11px] text-faint">Guest · this device</div>
              </div>
            </div>

            <Field label="Display name" htmlFor="guest-name" hint="2–24 characters">
              <Input
                id="guest-name"
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                placeholder="QuietFalcon42"
              />
            </Field>

            <div className="space-y-2">
              <div className="mono-label text-muted">Color</div>
              <div className="flex flex-wrap gap-2">
                {GUEST_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border transition",
                      color === swatch ? "border-ink" : "border-transparent hover:border-line-strong",
                    )}
                    style={{ background: swatch }}
                    aria-label={`Use color ${swatch}`}
                  >
                    {color === swatch ? <Check className="h-4 w-4 text-[#08090B]" /> : null}
                  </button>
                ))}
              </div>
            </div>

            {saveError ? (
              <div className="rounded-md border border-live/30 bg-live/5 p-3 text-[12px] text-live-soft">
                {saveError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving || name.trim().length < 2}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
