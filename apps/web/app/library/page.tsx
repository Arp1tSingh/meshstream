import type { Metadata } from "next";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { LibraryClient } from "@/components/library/LibraryClient";

export const metadata: Metadata = {
  title: "Library",
  description:
    "Rooms saved on this device and everything currently live on this MeshStream instance.",
};

export default function LibraryPage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <LibraryClient />
      <Footer />
    </div>
  );
}
