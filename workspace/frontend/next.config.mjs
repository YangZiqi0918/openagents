const localMode = process.env.NEXT_PUBLIC_LOCAL_MODE === 'true';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || (localMode ? 'http://localhost:8000' : 'https://workspace-endpoint.openagents.org');
const proxyUrl = process.env.API_INTERNAL_URL || apiUrl;
if (localMode && !['localhost', '127.0.0.1'].includes(new URL(apiUrl).hostname)) {
  throw new Error('Local mode requires a loopback NEXT_PUBLIC_API_URL');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async redirects() {
    if (localMode) {
      return ['/auth/callback', '/auth/desktop'].map((source) => ({
        source, destination: '/', permanent: false,
      }));
    }
    return [
      // NOTE: `/` on workspace.openagents.org used to redirect to the marketing
      // site. As of v1.0 `/` is the enforced-login Membership Home (workspace
      // picker), so that redirect is intentionally removed.
      {
        source: '/install.sh',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.sh',
        permanent: false,
      },
      {
        source: '/install.ps1',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.ps1',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/preview-home' }],
      afterFiles: [
        {
          source: '/wsapi/:path*',
          destination: `${proxyUrl.replace(/\/+$/, '')}/:path*`,
        },
      ],
      fallback: [],
    };
  },
  async headers() {
    if (!localMode) return [];
    const localOrigins = "http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:*";
    const policy = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ${localOrigins} ws://localhost:* ws://127.0.0.1:*`,
      `img-src 'self' data: blob: ${localOrigins}`,
      `media-src 'self' data: blob: ${localOrigins}`,
      "font-src 'self' data:",
      `frame-src 'self' ${localOrigins}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ');
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: policy }] }];
  },
};

export default nextConfig;
