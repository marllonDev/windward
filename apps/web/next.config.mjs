// The browser only ever talks to /api/v1 on this origin (ADR-0002). Next proxies
// it to the platform API, so no CORS and no engine port ever reaches the browser.
const apiUrl = process.env.API_URL ?? "http://api:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
