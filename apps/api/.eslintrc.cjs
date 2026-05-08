module.exports = {
  extends: ["@persai/eslint-config/nest.cjs"],
  ignorePatterns: ["dist"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
    ]
  }
};
