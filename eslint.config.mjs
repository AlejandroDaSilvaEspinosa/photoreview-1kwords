// eslint.config.mjs
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  js.configs.recommended,
  // Reusa la config de Next (modo compat)
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),
];
