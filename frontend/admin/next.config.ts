import type { NextConfig } from 'next';

// Admin Console acts as the Module Federation HOST.
// Plugin UIs are registered as REMOTE modules; they load lazily at runtime
// without requiring a host rebuild — URLs come from the plugin manifest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NextFederationPlugin } = require('@module-federation/nextjs-mf');

const nextConfig: NextConfig = {
  webpack(config, options) {
    if (!options.isServer) {
      config.plugins.push(
        new NextFederationPlugin({
          name: 'admin',
          filename: 'static/chunks/remoteEntry.js',
          remotes: {
            // URLs are injected via env vars; fallback to localhost for development.
            // Production values come from plugin manifest stored in DB/cache.
            customerPlugin: `customerPlugin@${process.env.CUSTOMER_PLUGIN_URL ?? 'http://localhost:3010'}/_next/static/chunks/remoteEntry.js`,
            analyticsPlugin: `analyticsPlugin@${process.env.ANALYTICS_PLUGIN_URL ?? 'http://localhost:3011'}/_next/static/chunks/remoteEntry.js`,
          },
          exposes: {
            // Admin exports shared design tokens so plugin UIs stay visually consistent.
            './DesignTokens': './src/lib/design-tokens.ts',
          },
          shared: {
            react: { singleton: true, requiredVersion: false },
            'react-dom': { singleton: true, requiredVersion: false },
          },
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
