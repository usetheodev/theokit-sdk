/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow Next.js to transpile workspace-linked packages.
  transpilePackages: ["@usetheo/sdk", "@usetheo/react"],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "sqlite-vec"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // The client bundle should NEVER contain SDK Node-only code. The hooks
      // (useTheoChat/Completion/Assistant) only need fetch + ReadableStream;
      // but `@usetheo/react` reexports streamTheoChat/Completion/Assistant
      // (server handlers) from the same entry, so the bundler follows the
      // import graph into `@usetheo/sdk` which uses `node:*` + better-sqlite3.
      // Fallback `false` strips those modules from the client bundle.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        zlib: false,
        net: false,
        tls: false,
        "node:fs": false,
        "node:fs/promises": false,
        "node:path": false,
        "node:os": false,
        "node:crypto": false,
        "node:stream": false,
        "node:module": false,
        "node:http": false,
        "node:https": false,
        "node:url": false,
        "node:readline/promises": false,
        "node:child_process": false,
        child_process: false,
        module: false,
        "node:sqlite": false,
        "better-sqlite3": false,
        "sqlite-vec": false,
        "@opentelemetry/api": false,
        keytar: false,
      };
    }
    return config;
  },
};

export default nextConfig;
