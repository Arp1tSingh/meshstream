import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: {
    default: "MeshStream — Live video that travels light",
    template: "%s · MeshStream",
  },
  description:
    "Peer-assisted live streaming in your browser. Go live in 720p, and let your audience relay the video. No accounts. No paid infrastructure.",
  applicationName: "MeshStream",
  keywords: ["live streaming", "WebRTC", "P2P", "LL-HLS", "peer-assisted"],
  authors: [{ name: "MeshStream" }],
  openGraph: {
    title: "MeshStream — Live video that travels light",
    description:
      "Peer-assisted live streaming in your browser. The audience becomes the network.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080A",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-void text-ink antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
