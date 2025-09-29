/** @type {import('next').NextConfig} */
const nextConfig = {
  // Para desarrollo - configuración de CORS
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ];
  },

  // Configuración para resolver el warning de múltiples lockfiles
  outputFileTracingRoot: __dirname,

  // Si necesitas exportación estática, descomenta la siguiente línea
  // output: 'export',

  // Configuración de imágenes para permitir dominios externos
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "drive.google.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
    qualities: [50, 75, 100],
  },

  // Configuración experimental
  experimental: {
    // Configuraciones experimentales si las necesitas
  },
};

module.exports = nextConfig;
