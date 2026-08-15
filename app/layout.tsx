import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Headless CMS — Admin Panel",
  description:
    "Define content schemas and manage entries through generated forms.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
