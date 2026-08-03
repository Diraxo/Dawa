/** @type {import('next').NextConfig} */

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://clerk.com https://*.clerk.accounts.dev https://clerk.dawaapp.online https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.clerk.com https://*.clerk.accounts.dev https://clerk.dawaapp.online https://challenges.cloudflare.com https://*.agora.io wss://*.agora.io:* https://*.sd-rtn.com wss://*.sd-rtn.com:* https://*.stream-io-api.com wss://*.stream-io-api.com https://*.stream-io-cdn.com",
      "media-src 'self' blob:",
      "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev https://clerk.dawaapp.online",
      "worker-src 'self' blob:",
    ].join('; '),
  },
];

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // pdfjs-dist (via react-pdf) ships pure ESM; Next 14's webpack mis-handles
  // its ESM/CJS interop and throws "Object.defineProperty called on
  // non-object" at module init. 'loose' fixes the interop without affecting
  // other packages. See https://github.com/vercel/next.js/issues/89177
  experimental: {
    esmExternals: 'loose',
  },
  // Next dev mode always runs the client bundle through an eval-based
  // devtool (eval-source-map), and pdfjs-dist's ESM build throws
  // "Object.defineProperty called on non-object" when executed inside an
  // eval() wrapper — that's the `eval` frame directly above pdf.mjs in the
  // error stack. Next reverts any `config.devtool` assignment made inside
  // this hook back to eval-source-map, so pin it via a getter/setter it
  // can't override. See https://github.com/wojtekmaj/react-pdf/wiki/Upgrade-guide-from-version-8.x-to-9.x
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      Object.defineProperty(config, 'devtool', {
        get() { return 'inline-source-map' },
        set() {},
      })
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'graph.facebook.com' },
      { protocol: 'https', hostname: 'platform-lookaside.fbsbx.com' },
      { protocol: 'https', hostname: '**.clerk.com' },
      { protocol: 'https', hostname: 'randomuser.me' },
    ],
  },
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
};

export default nextConfig;
