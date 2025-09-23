// eslint.config.mjs
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  js.configs.recommended,
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json", // opcional si usas reglas que necesitan type-checking
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Ejemplo: apagar no-explicit-any
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
