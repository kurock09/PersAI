import assert from "node:assert/strict";
import { KnowledgeEmbeddingService } from "../src/modules/workspace-management/application/knowledge-embedding.service";

type FetchCall = {
  url: string;
  init: RequestInit;
};

class FakeSecretStore {
  readonly requestedKeys: string[] = [];

  constructor(private readonly secrets: Record<string, string | null>) {}

  async resolveSecretValueByProviderKey(providerKey: string): Promise<string | null> {
    this.requestedKeys.push(providerKey);
    return this.secrets[providerKey] ?? null;
  }
}

async function withMockFetch<T>(
  handler: (url: string, init: RequestInit) => Promise<Response>,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runUsesOpenAiProviderSecret(): Promise<void> {
  const store = new FakeSecretStore({
    openai: "sk-openai"
  });
  const calls: FetchCall[] = [];
  const service = new KnowledgeEmbeddingService(store as never);

  const result = await withMockFetch(
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      });
    },
    () =>
      service.generateEmbeddings({
        modelKey: "text-embedding-3-large",
        texts: [" skill document chunk "]
      })
  );

  assert.deepEqual(store.requestedKeys, ["openai"]);
  assert.deepEqual(result, [[0.1, 0.2, 0.3]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/embeddings");
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer sk-openai"
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: "text-embedding-3-large",
    input: ["skill document chunk"]
  });
}

async function runMissingCredentialReturnsNullEmbeddings(): Promise<void> {
  const store = new FakeSecretStore({});
  const service = new KnowledgeEmbeddingService(store as never);
  let fetchCalled = false;

  const result = await withMockFetch(
    async () => {
      fetchCalled = true;
      return Response.json({ data: [] });
    },
    () =>
      service.generateEmbeddings({
        modelKey: "text-embedding-3-small",
        texts: ["chunk one", "chunk two"]
      })
  );

  assert.deepEqual(store.requestedKeys, ["openai"]);
  assert.deepEqual(result, [null, null]);
  assert.equal(fetchCalled, false);
}

async function main(): Promise<void> {
  await runUsesOpenAiProviderSecret();
  await runMissingCredentialReturnsNullEmbeddings();
}

void main();
