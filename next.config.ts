import type { NextConfig } from "next";

// SEC-02: clickjacking + transport hardening. Only `frame-ancestors` is set
// (no default-src/script-src/style-src/frame-src) so Next's inline runtime and
// the embedded Plaid Link child iframe keep working. A full CSP is a follow-up.
export const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
