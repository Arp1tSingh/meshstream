import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { PreflightClient } from "@/components/studio/PreflightClient";

export const metadata: Metadata = {
  title: "Studio setup",
  description:
    "Check your camera, name your room, and go live in 720p. No account needed — the host key stays in your browser.",
};

export default function StudioPage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <PreflightClient />
      <Footer />
    </div>
  );
}
