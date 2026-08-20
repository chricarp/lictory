import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "lictory.localhost", "*.lictory.localhost"],
  transpilePackages: ["@lictory/api-client", "@lictory/contracts"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
