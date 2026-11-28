import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import {
  buildSidecarPackage,
  SIDECAR_MANIFEST_FILENAME,
  SIDECAR_ZIP_FILENAME,
} from "../scripts/buildSidecarPackage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DOWNLOAD_ZIP_PATH = `/downloads/${SIDECAR_ZIP_FILENAME}`;
const DOWNLOAD_MANIFEST_PATH = `/downloads/${SIDECAR_MANIFEST_FILENAME}`;

// Vite-Plugin zur Bereitstellung des Sidecar-Download-ZIPs unter /downloads/ im Dev- und Production-Build
export function vitePluginSidecarPackage(repoRoot = REPO_ROOT): Plugin {
  return {
    name: "logic-circuit-sidecar-package",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "/").split("?")[0];
        if (pathname !== DOWNLOAD_ZIP_PATH && pathname !== DOWNLOAD_MANIFEST_PATH) {
          next();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET, HEAD");
          res.end("Method Not Allowed");
          return;
        }

        try {
          const pkg = buildSidecarPackage(repoRoot);
          res.setHeader("Cache-Control", "no-store");

          if (pathname === DOWNLOAD_MANIFEST_PATH) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            res.end(pkg.manifestJson);
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/zip");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="logic-circuit-sidecar-v${pkg.version}.zip"`,
          );
          res.setHeader("Content-Length", String(pkg.zipBuffer.length));
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          res.end(pkg.zipBuffer);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : "Sidecar package generation failed",
          }));
        }
      });
    },

    generateBundle() {
      const pkg = buildSidecarPackage(repoRoot);
      this.emitFile({
        type: "asset",
        fileName: `downloads/${SIDECAR_ZIP_FILENAME}`,
        source: new Uint8Array(pkg.zipBuffer),
      });
      this.emitFile({
        type: "asset",
        fileName: `downloads/${SIDECAR_MANIFEST_FILENAME}`,
        source: pkg.manifestJson,
      });
    },
  };
}

export default vitePluginSidecarPackage;
