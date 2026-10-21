import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { ViewerClient } from "@/components/viewer/ViewerClient";

export const metadata: Metadata = {
  title: "Watch live",
  description:
    "Watch a peer-assisted 720p live stream. Parts travel through nearby viewers, with origin fallback on every request.",
};

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-screen">
      <TopNav />
      <ViewerClient streamId={id} />
      <Footer />
    </div>
  );
}
