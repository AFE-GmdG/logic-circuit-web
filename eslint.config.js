import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import stylistic from "@stylistic/eslint-plugin";
import importX from "eslint-plugin-import-x";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lokales Plugin für projektspezifische Code-Richtlinien
const noNumberedCommentPlugin = {
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
      local: noNumberedCommentPlugin,
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

      "local/no-numbered-comments": "error",
    },
  },
];
