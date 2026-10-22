/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/tide_dpop/:path*',
        destination: '/tide_dpop_auth.html',
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/tide_dpop/:path*',
        headers: [
          {
            key: 'Allow-CSP-From',
            value: '*',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'sha256-utc6UrebuHOyLd/2aiMXS/p1EDy9UZBDe/XEMKDw9Mc='; style-src 'self' 'sha256-1tYy8m3c1KLuGI2eID9TfLkc50Y+iSPJMpI7n/apN/w=' 'sha256-F7OJTdJYct4J+cQfuJUoDauitndqt8pAc8EbA8gwDPU='",
          },
        ],
      },
    ]
  },
}

export default nextConfig
