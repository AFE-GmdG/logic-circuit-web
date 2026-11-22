import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import readPrivacyConfigFromEnv from "./server/privacyConfig.ts";
import vitePluginMcp from "./server/vitePluginMcp.ts";

import pkg from "./package.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildPrivacy = readPrivacyConfigFromEnv(env);
  const isMcpDisabled =
    mode === "pages" ||
    env.VITE_DISABLE_MCP === "true" ||
    env.VITE_DISABLE_MCP === "1";

  return {
    base: "./",
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      sourcemap: true,
      target: ["es2024"],
      outDir: "dist",
      emptyOutDir: true,
    },
    define: {
      "process.env.VERSION": JSON.stringify(pkg.version),
      "process.env.DISABLE_MCP": JSON.stringify(isMcpDisabled ? "true" : "false"),
      "process.env.PRIVACY_RESPONSIBLE_NAME": JSON.stringify(buildPrivacy.responsibleName),
      "process.env.PRIVACY_RESPONSIBLE_ADDRESS": JSON.stringify(buildPrivacy.responsibleAddress),
      "process.env.PRIVACY_CONTACT_EMAIL": JSON.stringify(buildPrivacy.contactEmail),
      "process.env.PRIVACY_HOSTING_LOCATION": JSON.stringify(buildPrivacy.hostingLocation),
    },
    plugins: [
      react(),
      ...(!isMcpDisabled ? [vitePluginMcp()] : []),
    ],
  };
});
