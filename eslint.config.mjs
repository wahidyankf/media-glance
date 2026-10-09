export default [
  {
    ignores: [
      "node_modules/**",
      "web/vendor/**",
      "build/**",
      "dist/**",
      ".coverage/**",
      ".deps/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(
        [
          "console",
          "process",
          "Buffer",
          "URL",
          "URLSearchParams",
          "setTimeout",
          "clearTimeout",
          "setImmediate",
          "globalThis",
          "window",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-constant-condition": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
      "constructor-super": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-self-assign": "error",
    },
  },
  {
    files: ["test/browser/journey.mjs"],
    languageOptions: {
      globals: {
        document: "readonly",
        getComputedStyle: "readonly",
        innerWidth: "readonly",
      },
    },
  },
];
