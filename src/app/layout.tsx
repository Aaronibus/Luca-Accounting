import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lúca — AI accounting for Ireland", template: "%s · Lúca" },
  description: "The AI-native accounting platform for Irish businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IE">
      <body>{children}</body>
    </html>
  );
}
