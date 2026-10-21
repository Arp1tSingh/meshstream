import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { HowItWorksClient } from "@/components/how/HowItWorksClient";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Follow one piece of live video from browser camera to origin, into 400 ms parts, through a WebRTC swarm, and back to origin when a peer fails.",
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <HowItWorksClient />
      <Footer />
    </div>
  );
}
