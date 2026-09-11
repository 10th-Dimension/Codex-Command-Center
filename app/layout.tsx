import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Command Center",
  description: "A private control plane for trusted engineering and agent signals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
