import React from "react";
import { createRoot } from "react-dom/client";

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";

import "./i18n";

import App from "./components/app";

// Emotion-Cache ohne Stylis-Plugins erstellen (deaktiviert alle Vendor-Prefixes)
const emotionCache = createCache({
  key: "css",
  stylisPlugins: [],
});

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <CacheProvider value={emotionCache}>
      <App />
    </CacheProvider>,
  );
}
