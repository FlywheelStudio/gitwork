import { APP_NAME } from "@gitwork/core";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Project management on top of GitHub.",
};

// Dark mode follows the system setting, before the first paint (no flash of the light theme).
const THEME = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){document.documentElement.classList.toggle("dark",m.matches)}a();m.addEventListener("change",a)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The theme script sets the "dark" class before React hydrates.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
