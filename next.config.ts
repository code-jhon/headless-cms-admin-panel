import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Origins allowed to reach dev-only endpoints.
   *
   * Next.js blocks cross-origin requests to dev assets by default, and the
   * server is initialised on `localhost`. Opening the panel from another
   * device over a LAN IP therefore fails to open the hot-reload websocket
   * (`/_next/hmr`) — which is easy to mistake for the app's realtime
   * connection failing, since the browser reports both the same way.
   *
   * This affects development only; it has no effect on a production build.
   * Private ranges are listed rather than a blanket wildcard so the dev
   * server stays closed to anything off the local network.
   */
  allowedDevOrigins: [
    "192.168.0.*",
    "192.168.1.*",
    "10.0.0.*",
    "10.0.1.*",
    "172.16.0.*",
    "*.local",
  ],
};

export default nextConfig;
