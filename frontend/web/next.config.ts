import type { NextConfig } from 'next';

// Module Federation (web = REMOTE, exposes ./ContactsList) is Phase 6+ roadmap.
// @module-federation/nextjs-mf is not compatible with Next.js 15.
// Plugin is disabled until a compatible version is available.

const nextConfig: NextConfig = {};

export default nextConfig;
