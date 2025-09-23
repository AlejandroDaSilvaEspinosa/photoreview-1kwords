// eslint.config.mjs
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  // 1) Ignora directorios generados y el tipo de Supabase
  { ignores: ["**/node_modules/**", "**/.next/**", "src/types/supabase.ts"] },

  // 2) Base JS
  js.configs.recommended,

  // 3) Config de Next (core-web-vitals + TS)
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),

  // 4) Soporte TS y reglas
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // ⚠️ Si no necesitas reglas con type-checking, omite "project" para evitar problemas en CI
        // project: "./tsconfig.json",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-expressions": [
        "warn",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn", // o "off"
    },
  },
];
