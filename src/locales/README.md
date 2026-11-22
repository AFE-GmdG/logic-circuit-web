# UI Translations & Community Contributions

Logic Circuit Web uses `i18next` and `react-i18next` with **English (`en.json`)** as the leading master catalog.

## Adding a New Community Translation

To add a new language, you only need to create **one JSON file** inside `src/locales/`:

- Name the file after its BCP-47 language tag (for example `fr.json`, `es.json`, `ja.json`, or `pt-BR.json`).
- Copy the keys you want to translate from `src/locales/en.json` into your new file.
- Set `meta.nativeName` to the language's own name (for example `"Français"`, `"Español"`, `"Português (Brasil)"`). If `meta.nativeName` is omitted, `src/i18n.ts` derives it automatically via `Intl.DisplayNames`.
- Save the file and run `yarn test`.

No TypeScript or UI code changes are required:

- `src/i18n.ts` automatically discovers all `src/locales/*.json` files via `import.meta.glob`.
- The language selector in the Options dialog lists every discovered locale automatically.
- Browser language auto-detection matches exact tags first (such as `pt-BR`) and then base tags (such as `pt` or `fr`).

## Master & Subset Rules

- **`en.json` is complete:** Every translation key referenced in the UI must exist in `src/locales/en.json`.
- **Other locales may be partial:** You do not need to translate every single entry right away. Any omitted key automatically falls back to the English text at runtime.
- **No unknown or empty keys:** Non-English locale files must only define keys that exist in `src/locales/en.json` (plus valid CLDR plural suffixes for pluralized keys), and must not contain empty strings.
- **Keep interpolation placeholders intact:** Preserve placeholders like `{{count}}`, `{{name}}`, `{{hz}}`, or `{{language}}` exactly as spelled in `en.json`.

## Singular & Plural Variants (`i18next` v4)

Count-dependent messages (especially errors and status messages) use `i18next` v4 plural suffixes driven by the `count` interpolation parameter:

- In English and German: define `<key>_one` and `<key>_other` (for example `directoriesCount_one` and `directoriesCount_other`).
- In languages with richer CLDR plural rules (such as Polish, Russian, or Arabic): you may also define `_zero`, `_two`, `_few`, or `_many` whenever the base key is pluralized in `en.json` (i.e. `<key>_other` exists in `en.json`) and that plural category applies to your locale in `Intl.PluralRules`.
- In languages with a single plural category (such as Japanese): `<key>_other` alone is sufficient.
