import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { SettingsClient } from "@/components/settings/SettingsClient";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Guest identity, playback preferences, local host keys, and diagnostics for this device.",
};

export default function SettingsPage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <SettingsClient />
      <Footer />
    </div>
  );
}
