import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitMatch: your jeans size at any brand",
  description:
    "Tell FitMatch which jeans already fit you and get your size at another brand, with a confidence level you can trust.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
