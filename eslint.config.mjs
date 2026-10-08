import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import globals from "globals";

// Keep the React, hooks, import and accessibility checks formerly supplied by
// eslint-config-next. Its Next plugin pulls in an unpatched braces advisory.
const config = [
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] },
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: { react, "react-hooks": reactHooks, import: importPlugin, "jsx-a11y": jsxA11y },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
  },
];

export default config;
