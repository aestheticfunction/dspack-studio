/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: [
    "@dspack-studio/a2ui-ingest",
    "@dspack-studio/astryx-renderers",
    "@dspack-studio/contracts",
  ],
};

export default nextConfig;
