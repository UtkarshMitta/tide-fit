/**
 * Inside a GitHub Codespace the app is served from a forwarded hostname such as
 * `<codespace>-3000.app.github.dev`, and Next blocks cross-origin requests to the
 * dev server by default. Allow exactly that one hostname, and only when running
 * in a codespace. A blanket `*.app.github.dev` would let any page on any
 * codespace read the dev server of anyone running `npm run dev` locally.
 */
const codespaceOrigin =
  process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: codespaceOrigin ? [codespaceOrigin] : [],
};

export default nextConfig;
