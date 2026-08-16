import type { Metadata } from "next";

import { THEME_SCRIPT } from "@/lib/theme/script";

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
    /*
     * `suppressHydrationWarning` is scoped to <html> on purpose. The inline
     * script below mutates this element's class list before React hydrates,
     * so the server markup and the live DOM are *expected* to differ here and
     * only here — it is not a blanket suppression of hydration checks for the
     * tree.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint — see lib/theme/script.ts for why. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
