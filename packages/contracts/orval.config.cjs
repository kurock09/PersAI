module.exports = {
  step2: {
    input: {
      target: "./openapi.yaml"
    },
    output: {
      target: "./src/generated/step2-client.ts",
      schemas: "./src/generated/model",
      client: "fetch",
      mode: "split",
      override: {
        mutator: {
          path: "./src/mutator/custom-fetch.ts",
          name: "customFetch"
        }
      }
    }
  }
};
