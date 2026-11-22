import { beforeEach } from "vitest";

import i18n from "../i18n";

void i18n.changeLanguage("de");

beforeEach(async () => {
  await i18n.changeLanguage("de");
});
