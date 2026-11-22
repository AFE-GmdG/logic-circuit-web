import path from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importX from "eslint-plugin-import-x";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lokales Plugin für projektspezifische Code-Richtlinien
const HOOK_NAMES = new Set(["useMemo", "useCallback", "useEffect", "useLayoutEffect"]);
const REL_PREFIX = "{.,..,../..,../../..,../../../..,../src,../../src}";

const localCodingRulesPlugin = {
  rules: {
    "no-numbered-comments": {
      meta: {
        type: "problem",
        docs: {
          description: "Verbietet nummerierte Listen und Schrittfolgen in Kommentaren",
        },
        messages: {
          noNumberedComment: "Keine nummerierten Listen in Kommentaren ('{{match}}'). Schreibe stattdessen deskriptive Kommentare.",
        },
      },
      create(context) {
        // Erkennt: "// 1.", "// 1)", "// 1 -", "// Step 1", "// Schritt 1"
        const pattern = /^\s*(?:\d+[\.\)\-]|step\s*\d+|schritt\s*\d+)/i;

        return {
          Program() {
            const comments = context.sourceCode.getAllComments();
            for (const comment of comments) {
              const trimmed = comment.value.trim();
              const match = trimmed.match(pattern);
              if (match) {
                context.report({
                  loc: comment.loc,
                  messageId: "noNumberedComment",
                  data: { match: match[0] },
                });
              }
            }
          },
        };
      },
    },
    "react-default-import-only": {
      meta: {
        type: "problem",
        docs: {
          description: "Erzwingt den Default-Import von react ohne benannte oder Namespace-Imports",
        },
        messages: {
          reactDefaultOnly: "Nur 'import React from \"react\";' ist zulässig; benannte oder Namespace-Imports aus 'react' sind verboten.",
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "react") {
              return;
            }
            for (const spec of node.specifiers) {
              if (spec.type !== "ImportDefaultSpecifier") {
                context.report({
                  node: spec,
                  messageId: "reactDefaultOnly",
                });
              }
            }
          },
        };
      },
    },
    "hook-formatting": {
      meta: {
        type: "layout",
        docs: {
          description: "Prüft React.-Präfix, Zeilenumbrüche und Dependency-Array-Formatierung für React Hooks",
        },
        messages: {
          requireReactPrefix: "Hook '{{name}}' muss über den Namespace 'React.{{name}}' aufgerufen werden.",
          callbackNewLine: "Die Callback-Funktion von 'React.{{name}}' muss auf einer eigenen eingerückten Zeile beginnen.",
          depsNewLine: "Das Dependency-Array von 'React.{{name}}' muss unter der schließenden Klammer '},' beginnen.",
          depsSingleLine: "Dependency-Arrays mit weniger als 3 Abhängigkeiten müssen einzeilig geschrieben werden.",
          depsMultiLine: "Dependency-Arrays mit 3 oder mehr Abhängigkeiten müssen mehrzeilig mit genau einem Eintrag pro Zeile geschrieben werden.",
          depsTrailingComma: "Nach dem Dependency-Array von 'React.{{name}}' fehlt das abschließende Komma.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            let hookName = null;
            let hasReactPrefix = false;

            if (node.callee.type === "Identifier" && HOOK_NAMES.has(node.callee.name)) {
              hookName = node.callee.name;
            } else if (
              node.callee.type === "MemberExpression" &&
              !node.callee.computed &&
              node.callee.object.type === "Identifier" &&
              node.callee.object.name === "React" &&
              node.callee.property.type === "Identifier" &&
              HOOK_NAMES.has(node.callee.property.name)
            ) {
              hookName = node.callee.property.name;
              hasReactPrefix = true;
            }

            if (!hookName) {
              return;
            }

            if (!hasReactPrefix) {
              context.report({
                node: node.callee,
                messageId: "requireReactPrefix",
                data: { name: hookName },
              });
            }

            const cb = node.arguments[0];
            if (!cb) {
              return;
            }

            if (cb.loc.start.line === node.loc.start.line) {
              context.report({
                node: cb,
                messageId: "callbackNewLine",
                data: { name: hookName },
              });
            }

            const deps = node.arguments[1];
            if (!deps || deps.type !== "ArrayExpression") {
              return;
            }

            if (deps.loc.start.line === cb.loc.end.line) {
              context.report({
                node: deps,
                messageId: "depsNewLine",
                data: { name: hookName },
              });
            }

            if (deps.elements.length < 3) {
              if (deps.loc.start.line !== deps.loc.end.line) {
                context.report({
                  node: deps,
                  messageId: "depsSingleLine",
                });
              }
            } else {
              const seenLines = new Set();
              let hasLineViolation = deps.loc.start.line === deps.loc.end.line;
              for (const el of deps.elements) {
                if (!el) {
                  continue;
                }
                if (el.loc.start.line === deps.loc.start.line || seenLines.has(el.loc.start.line)) {
                  hasLineViolation = true;
                  break;
                }
                seenLines.add(el.loc.start.line);
              }
              if (hasLineViolation) {
                context.report({
                  node: deps,
                  messageId: "depsMultiLine",
                });
              }
            }

            const nextToken = context.sourceCode.getTokenAfter(deps);
            if (!nextToken || nextToken.value !== ",") {
              context.report({
                node: deps,
                messageId: "depsTrailingComma",
                data: { name: hookName },
              });
            }
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/reference/**",
      "**/*.ref.js",
    ],
  },
  {
    files: ["**/*.js", "**/*.ts", "**/*.tsx", "**/*.mjs"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [path.resolve(__dirname, "tsconfig.eslint.json")],
        tsconfigRootDir: __dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },

    plugins: {
      tseslint,
      "@stylistic": stylistic,
      "import-x": importX,
      local: localCodingRulesPlugin,
    },

    rules: {
      "array-bracket-spacing": ["error", "never"],
      "comma-dangle": ["error", {
        arrays: "always-multiline",
        objects: "always-multiline",
        imports: "always-multiline",
        exports: "always-multiline",
        functions: "always-multiline",
      }],
      "comma-spacing": ["error", { before: false, after: true }],
      "comma-style": ["error", "last"],
      "dot-location": ["error", "property"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "max-len": [2, 160, 2, { ignoreUrls: true }],
      "no-async-promise-executor": "off",
      "no-console": "off",
      "no-debugger": "warn",
      "no-implicit-globals": "error",
      "no-implied-eval": "error",
      "no-labels": "error",
      "no-loop-func": "error",
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1 }],
      "no-nested-ternary": "off",
      "no-param-reassign": ["warn", { props: false }],
      "no-plusplus": "off",
      "no-trailing-spaces": "error",
      "no-underscore-dangle": ["error", { allow: ["__dirname"], allowAfterThis: true }],
      "no-var": "error",
      "object-curly-newline": ["error", { multiline: true, minProperties: 8, consistent: true }],
      "prefer-const": "error",
      "space-in-parens": ["error", "never"],
      "space-infix-ops": ["error", { int32Hint: true }],
      "space-unary-ops": "error",

      "no-unused-vars": "off",
      "tseslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-array-constructor": "off",
      "tseslint/no-array-constructor": "error",
      "no-useless-constructor": "off",
      "tseslint/no-useless-constructor": "error",
      "no-dupe-class-members": "off",
      "tseslint/no-dupe-class-members": "error",
      "default-param-last": "off",
      "tseslint/default-param-last": "error",
      "dot-notation": "off",
      "tseslint/dot-notation": ["error", { allowKeywords: true }],
      "no-empty-function": "off",
      "tseslint/no-empty-function": ["error", { allow: ["arrowFunctions", "functions", "methods"] }],
      "no-magic-numbers": "off",
      "tseslint/no-magic-numbers": ["off", { ignore: [], ignoreArrayIndexes: true, enforceConst: true, detectObjects: false }],
      "no-redeclare": "off",
      "tseslint/no-redeclare": "error",
      "no-unused-expressions": "off",
      "tseslint/no-unused-expressions": ["error", { allowShortCircuit: false, allowTernary: false, allowTaggedTemplates: false }],
      "no-return-await": "off",
      "tseslint/return-await": "off",
      "naming-convention": "off",
      "tseslint/naming-convention": "off",
      "tseslint/consistent-type-definitions": ["error", "type"],
      "tseslint/no-explicit-any": "error",

      "@stylistic/indent": ["error", 2, {
        SwitchCase: 1,
        VariableDeclarator: 1,
        outerIIFEBody: 1,
        FunctionDeclaration: {
          parameters: 1,
          body: 1,
        },
        FunctionExpression: {
          parameters: 1,
          body: 1,
        },
        CallExpression: {
          arguments: 1,
        },
        ArrayExpression: 1,
        ObjectExpression: 1,
        ImportDeclaration: 1,
        flatTernaryExpressions: false,
        ignoreComments: false,
      }],
      "@stylistic/keyword-spacing": ["error", {
        before: true,
        after: true,
        overrides: { return: { after: true }, throw: { after: true }, case: { after: true } },
      }],
      "@stylistic/lines-between-class-members": ["error", { enforce: [{ blankLine: "always", prev: "*", next: "method" }] }, { exceptAfterSingleLine: true }],
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/quotes": ["error", "double"],
      "@stylistic/quote-props": ["error", "as-needed"],
      "@stylistic/require-await": "off",
      "@stylistic/semi": ["error", "always"],
      "@stylistic/no-extra-semi": "error",
      "@stylistic/space-before-blocks": "error",
      "@stylistic/space-before-function-paren": ["error", { anonymous: "always", named: "never", asyncArrow: "always" }],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],

      "no-throw-literal": "off",
      "@/no-throw-literal": "error",
      "func-call-spacing": "off",
      "@/func-call-spacing": ["error", "never"],

      "import-x/prefer-default-export": ["error", { target: "single" }],
      "import-x/order": ["error", {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index",
        ],
        pathGroups: [
          { pattern: "{react,react-dom,react-dom/**}", group: "builtin", position: "before" },
          { pattern: `{.,${REL_PREFIX}/{contexts,hooks}{,/**}}`, group: "internal", position: "before" },
          { pattern: `{${REL_PREFIX}/types/**,./gateShapeProps,./ioProps}`, group: "internal", position: "before" },
          { pattern: `${REL_PREFIX}/{audio,i18n,mcp,server,simulation,utils}{,/**}`, group: "internal", position: "after" },
          { pattern: `${REL_PREFIX}/components/**`, group: "parent", position: "after" },
          { pattern: `${REL_PREFIX}/**/*.{json,svg,png,css}`, group: "index", position: "after" },
        ],
        pathGroupsExcludedImportTypes: ["builtin"],
        distinctGroup: true,
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
        warnOnUnassignedImports: false,
      }],

      "local/no-numbered-comments": "error",
      "local/react-default-import-only": "error",
      "local/hook-formatting": "error",
    },
  },
  {
    files: ["src/utils/**/*.ts"],
    rules: {
      "import-x/prefer-default-export": "off",
    },
  },
  {
    files: ["src/test/**/*.ts", "src/test/**/*.tsx", "server/test/**/*.ts"],
    rules: {
      "tseslint/no-explicit-any": "off",
    },
  },
];
