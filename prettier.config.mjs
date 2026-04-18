/**
 * @type {import("prettier").Config}
 */
const config = {
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  // Based on sentry.js's prettier config.
  importOrder: [
    // Node.js builtins.
    "<BUILTIN_MODULES>",
    "",
    // Packages. `react` related packages come first.
    "^react",
    "<THIRD_PARTY_MODULES>",
    "",
    // Internal alias imports.
    "^#/(.*)$",
    "",
    // Parent imports. Put `..` last.
    "^\\.\\./(?!/?$)",
    "^\\.\\./\\.?$",
    "",
    // Other relative imports. Put same-folder imports and `.` last.
    "^\\./(?=.*/)(?!/?$)",
    "^\\.(?!/?$)",
    "^\\./?$",
    // Newline after imports.
    "",
  ],
  bracketSpacing: false,
  bracketSameLine: false,
  printWidth: 100,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
  arrowParens: "avoid",
};

export default config;
