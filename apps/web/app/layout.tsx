import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Source_Serif_4, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Multica — Project Management for Human + Agent Teams", template: "%s · Multica" },
  description:
    "Multica is an open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills — manage your human + agent workforce in one place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#05070b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${sourceSerif.variable} ${geistMono.variable}`}
    >
      <body className="min-h-dvh bg-white font-sans text-[#0a0d12] antialiased" data-density="comfortable">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
