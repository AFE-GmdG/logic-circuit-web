export const SIDECAR_ZIP_FILENAME: string;
export const SIDECAR_MANIFEST_FILENAME: string;
export const SIDECAR_NODE_MIN_VERSION: string;
export const SIDECAR_DEFAULT_PORT: number;

export type SidecarZipEntry = {
  path: string;
  data: Buffer | string;
  mode?: number;
};

export type SidecarManifest = {
  version: string;
  nodeMinVersion: string;
  defaultPort: number;
  downloadFileName: string;
  endpoints: {
    mcpHttp: string;
    mcpWs: string;
    mcpStatus: string;
    collabWs: string;
    collabConfig: string;
    healthz: string;
  };
  files: string[];
};

export function parseDockerfileCopySources(dockerfileContent: string): string[];
export function createZipBuffer(entries: SidecarZipEntry[]): Buffer;
export function collectSidecarPackageEntries(repoRoot?: string): {
  version: string;
  manifest: SidecarManifest;
  manifestJson: string;
  entries: SidecarZipEntry[];
};
export function buildSidecarPackage(repoRoot?: string): {
  version: string;
  manifest: SidecarManifest;
  manifestJson: string;
  zipBuffer: Buffer;
};
export function writeSidecarPackage(outputDir: string, repoRoot?: string): {
  version: string;
  manifest: SidecarManifest;
  zipPath: string;
  manifestPath: string;
  byteLength: number;
};
