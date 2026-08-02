import assert from "node:assert/strict";
import { MailboxOAuthTokenExchangeClientService } from "../src/modules/workspace-management/application/mailbox-oauth-token-exchange.client";

async function testMailRuUserInfoUsesAccessTokenQueryParameter(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let request: Request | null = null;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ email: "owner@mail.ru" }), { status: 200 });
  };

  try {
    const client = new MailboxOAuthTokenExchangeClientService();
    const outcome = await client.fetchUserInfo({
      userInfoEndpoint: "https://oauth.mail.ru/userinfo",
      accessToken: "mailru-access-token",
      accessTokenTransport: "query_parameter"
    });

    assert.equal(outcome.kind, "success");
    assert.equal(request?.url, "https://oauth.mail.ru/userinfo?access_token=mailru-access-token");
    assert.equal(request?.headers.get("authorization"), null);
    console.log("✓ Mail.ru userinfo receives its access token in the query parameter");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testYandexUserInfoUsesBearerHeader(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let request: Request | null = null;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ default_email: "owner@yandex.ru" }), { status: 200 });
  };

  try {
    const client = new MailboxOAuthTokenExchangeClientService();
    const outcome = await client.fetchUserInfo({
      userInfoEndpoint: "https://login.yandex.ru/info",
      accessToken: "yandex-access-token",
      accessTokenTransport: "bearer_header"
    });

    assert.equal(outcome.kind, "success");
    assert.equal(request?.url, "https://login.yandex.ru/info");
    assert.equal(request?.headers.get("authorization"), "Bearer yandex-access-token");
    console.log("✓ Yandex userinfo receives its access token in the bearer header");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run(): Promise<void> {
  await testMailRuUserInfoUsesAccessTokenQueryParameter();
  await testYandexUserInfoUsesBearerHeader();
  console.log("\n✅ All mailbox-oauth-token-exchange.client tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
