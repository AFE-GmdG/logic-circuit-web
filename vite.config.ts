import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import readPrivacyConfigFromEnv from "./server/privacyConfig.ts";
import vitePluginCollab from "./server/vitePluginCollab.ts";
import vitePluginMcp from "./server/vitePluginMcp.ts";
import vitePluginSidecarPackage from "./server/vitePluginSidecarPackage.ts";

import pkg from "./package.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildPrivacy = readPrivacyConfigFromEnv(env);
  const isCustomSidecarOnly =
    mode === "pages" ||
    env.VITE_SIDECAR_CUSTOM_ONLY === "true" ||
    env.VITE_SIDECAR_CUSTOM_ONLY === "1";
  const isMcpDisabled =
    env.VITE_DISABLE_MCP === "true" ||
    env.VITE_DISABLE_MCP === "1";
  const isCollabDisabled =
    env.VITE_DISABLE_COLLAB === "true" ||
    env.VITE_DISABLE_COLLAB === "1";

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
      chunkSizeWarningLimit: 2500,
    },
    define: {
      "process.env.VERSION": JSON.stringify(pkg.version),
      "process.env.DISABLE_MCP": JSON.stringify(isMcpDisabled ? "true" : "false"),
      "process.env.DISABLE_COLLAB": JSON.stringify(isCollabDisabled ? "true" : "false"),
      "process.env.SIDECAR_CUSTOM_ONLY": JSON.stringify(isCustomSidecarOnly ? "true" : "false"),
      "process.env.PRIVACY_RESPONSIBLE_NAME": JSON.stringify(buildPrivacy.responsibleName),
      "process.env.PRIVACY_RESPONSIBLE_ADDRESS": JSON.stringify(buildPrivacy.responsibleAddress),
      "process.env.PRIVACY_CONTACT_EMAIL": JSON.stringify(buildPrivacy.contactEmail),
      "process.env.PRIVACY_HOSTING_LOCATION": JSON.stringify(buildPrivacy.hostingLocation),
    },
    plugins: [
      react(),
      ...(!isMcpDisabled ? [vitePluginMcp()] : []),
      ...(!isCollabDisabled ? [vitePluginCollab()] : []),
      ...(!(isMcpDisabled && isCollabDisabled) ? [vitePluginSidecarPackage()] : []),
    ],
  };
});
