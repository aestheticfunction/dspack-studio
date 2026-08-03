/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: [
    "@dspack-studio/a2ui-ingest",
    "@dspack-studio/composer-core",
    "@dspack-studio/shadcn-renderers",
    "@dspack-studio/wireframe-renderers",
  ],
};

export default nextConfig;
