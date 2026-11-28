declare const process: {
  readonly env: {
    readonly VERSION: string;
    readonly DISABLE_MCP?: string;
    readonly DISABLE_COLLAB?: string;
    readonly SIDECAR_CUSTOM_ONLY?: string;
    readonly PRIVACY_RESPONSIBLE_NAME?: string;
    readonly PRIVACY_RESPONSIBLE_ADDRESS?: string;
    readonly PRIVACY_CONTACT_EMAIL?: string;
    readonly PRIVACY_HOSTING_LOCATION?: string;
  };
};
