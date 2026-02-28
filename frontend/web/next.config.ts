import type { NextConfig } from 'next';

// Web App acts as a Module Federation REMOTE.
// It exposes ContactsList and DealsList so the Admin Console (HOST)
// or any authorised shell can lazy-load CRM widgets at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NextFederationPlugin } = require('@module-federation/nextjs-mf');

const nextConfig: NextConfig = {
  webpack(config, options) {
    if (!options.isServer) {
      config.plugins.push(
        new NextFederationPlugin({
          name: 'web',
          filename: 'static/chunks/remoteEntry.js',
          exposes: {
            './ContactsList': './src/components/contacts-list.tsx',
            './DealsList': './src/components/deals-list.tsx',
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
