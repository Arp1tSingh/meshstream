import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { StudioClient } from "@/components/studio/StudioClient";

export const metadata: Metadata = {
  title: "Studio",
  description: "Browser WHIP publishing, room health, local recording, and live chat.",
};

export default async function StudioRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-screen">
      <TopNav />
      <StudioClient streamId={id} />
    </div>
  );
}
