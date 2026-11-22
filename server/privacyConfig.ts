import type PrivacyConfig from "../src/types/privacyConfig.ts";

// Liest die optionalen DSGVO-Betreiberangaben aus Umgebungsvariablen (PRIVACY_* bzw. VITE_PRIVACY_*)
export function readPrivacyConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PrivacyConfig {
  const read = (primaryKey: string, viteKey: string): string => {
    const value = env[primaryKey] ?? env[viteKey] ?? "";
    return typeof value === "string" ? value.trim() : "";
  };

  return {
    responsibleName: read("PRIVACY_RESPONSIBLE_NAME", "VITE_PRIVACY_RESPONSIBLE_NAME"),
    responsibleAddress: read("PRIVACY_RESPONSIBLE_ADDRESS", "VITE_PRIVACY_RESPONSIBLE_ADDRESS"),
    contactEmail: read("PRIVACY_CONTACT_EMAIL", "VITE_PRIVACY_CONTACT_EMAIL"),
    hostingLocation: read("PRIVACY_HOSTING_LOCATION", "VITE_PRIVACY_HOSTING_LOCATION"),
  };
}

export default readPrivacyConfigFromEnv;
