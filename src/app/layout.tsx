import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "TideFit — AI trip planning for athletes",
  description:
    "Day-by-day trip itineraries that respect real conditions: sea state, air quality, wind and heat, grounded in live local search and narrated as a morning voice briefing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Extensions such as Dark Reader add attributes to <html> before React loads.
    // This covers only this element's own attributes, one level deep.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-deep text-slate-100 antialiased`}
      >
        <div className="pointer-events-none fixed inset-0 -z-10 bg-tide-glow" aria-hidden />
        {children}
      </body>
    </html>
  );
}
