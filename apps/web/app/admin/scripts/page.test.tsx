import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import ruMessages from "../../../messages/ru.json";
import type { ScriptState, ScriptVersionState } from "@/app/app/assistant-api-client";
import AdminScriptsPage, {
  draftToScriptCreatePayload,
  draftToScriptUpdatePayload,
  draftToVersionWritePayload,
  resolveVersionEditorSeed,
  scriptToDraft,
  seedDraftCreateFromPublished,
  validateScriptDraft,
  validateVersionDraftJson,
  versionToDraft
} from "./page";

const api = vi.hoisted(() => ({
  getAdminScripts: vi.fn(),
  getAdminSkills: vi.fn(),
  getAdminScriptVersions: vi.fn(),
  getAdminSkillScripts: vi.fn(),
  createAdminScript: vi.fn(),
  updateAdminScript: vi.fn(),
  archiveAdminScript: vi.fn(),
  createAdminScriptVersion: vi.fn(),
  updateAdminScriptVersion: vi.fn(),
  validateAdminScriptVersion: vi.fn(),
  publishAdminScriptVersion: vi.fn(),
  replaceAdminSkillScripts: vi.fn()
}));
const clerk = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: clerk.getToken })
}));

vi.mock("@/app/app/assistant-api-client", async () => {
  const actual = await vi.importActual<typeof import("@/app/app/assistant-api-client")>(
    "@/app/app/assistant-api-client"
  );
  return { ...actual, ...api };
});

function createScript(overrides: Partial<ScriptState> = {}): ScriptState {
  return {
    id: "00000000-0000-4000-8000-000000000501",
    key: "send_report",
    name: { en: "Send report", ru: "Отправить отчёт" },
    description: { en: "Sends a report.", ru: "Отправляет отчёт." },
    status: "draft",
    category: "automation",
    icon: null,
    color: null,
    displayOrder: 10,
    currentPublishedVersionId: null,
    createdByUserId: "user-1",
    updatedByUserId: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides
  };
}

function createVersion(overrides: Partial<ScriptVersionState> = {}): ScriptVersionState {
  return {
    id: "00000000-0000-4000-8000-000000000601",
    scriptId: "00000000-0000-4000-8000-000000000501",
    version: 1,
    status: "draft",
    code: "print('hi')",
    manifest: { schemaVersion: 1, workingDirectory: null, environment: {} },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    runtime: "python3",
    entryCommand: 'python3 "$PERSAI_SCRIPT_ENTRY_PATH"',
    limits: { timeoutMs: 5_000, maxMemoryMb: 256, maxCpuMillicores: 500, maxOutputBytes: 65_536 },
    contentHash: null,
    revision: 1,
    createdByUserId: "user-1",
    publishedByUserId: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    publishedAt: null,
    ...overrides
  };
}

const skillOne = {
  id: "00000000-0000-4000-8000-000000000701",
  status: "active",
  name: { en: "Reporting", ru: "Отчётность" },
  category: "work"
};
const skillTwo = {
  ...skillOne,
  id: "00000000-0000-4000-8000-000000000702",
  name: { en: "Delivery", ru: "Доставка" }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPage(locale: "en" | "ru") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ru" ? ruMessages : enMessages}>
      <AdminScriptsPage />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  clerk.getToken.mockResolvedValue("token");
  api.getAdminScripts.mockResolvedValue([createScript()]);
  api.getAdminSkills.mockResolvedValue([skillOne]);
  api.getAdminScriptVersions.mockResolvedValue([]);
  api.getAdminSkillScripts.mockResolvedValue([]);
  api.createAdminScript.mockResolvedValue(createScript({ key: "new_script" }));
  api.updateAdminScript.mockImplementation(async (_token, _id, payload) => ({
    ...createScript(),
    ...payload
  }));
  api.archiveAdminScript.mockResolvedValue(createScript({ status: "archived" }));
  api.createAdminScriptVersion.mockResolvedValue(createVersion());
  api.updateAdminScriptVersion.mockImplementation(
    async (_token, _scriptId, _versionId, payload) => ({
      ...createVersion(),
      ...payload,
      revision: 2
    })
  );
  api.validateAdminScriptVersion.mockResolvedValue(createVersion());
  api.publishAdminScriptVersion.mockResolvedValue({
    script: createScript({ status: "published", currentPublishedVersionId: createVersion().id }),
    version: createVersion({ status: "published", publishedAt: "2026-07-17T01:00:00.000Z" })
  });
  api.replaceAdminSkillScripts.mockImplementation(async (_token, _skillId, payload) =>
    payload.scriptIds.map((scriptId: string, index: number) => ({
      scriptId,
      displayOrder: index,
      createdAt: "2026-07-17T00:00:00.000Z",
      script: createScript({ id: scriptId })
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin scripts page helpers", () => {
  it("round-trips a Script draft into create/update payloads", () => {
    const draft = scriptToDraft(createScript());
    expect(draft.key).toBe("send_report");
    expect(draft.nameRu).toBe("Отправить отчёт");

    const createPayload = draftToScriptCreatePayload({ ...draft, id: null, key: "new_key" });
    expect(createPayload.key).toBe("new_key");
    expect(createPayload.category).toBe("automation");

    const updatePayload = draftToScriptUpdatePayload(draft);
    expect(updatePayload).not.toHaveProperty("key");
    expect(updatePayload.category).toBe("automation");
  });

  it("requires an immutable lowercase key on create and localized name/description", () => {
    const draft = scriptToDraft(createScript());
    expect(validateScriptDraft({ ...draft, id: null, key: "Bad Key" }, "create")).toBe(
      "invalidKey"
    );
    expect(validateScriptDraft({ ...draft, nameRu: "" }, "update")).toBe("localizedName");
    expect(validateScriptDraft({ ...draft, descriptionEn: "" }, "update")).toBe(
      "localizedDescription"
    );
  });

  it("pins canonical Script metadata trimming, lengths, and display-order bounds", () => {
    const base = scriptToDraft(createScript());
    const validEdge = {
      ...base,
      id: null,
      key: "  edge_key  ",
      nameEn: `  ${"n".repeat(500)}  `,
      nameRu: `  ${"и".repeat(500)}  `,
      descriptionEn: `  ${"d".repeat(2_000)}  `,
      descriptionRu: `  ${"о".repeat(2_000)}  `,
      category: `  ${"c".repeat(64)}  `,
      icon: `  ${"i".repeat(64)}  `,
      color: `  ${"f".repeat(32)}  `,
      displayOrder: " -1000000 "
    };
    expect(validateScriptDraft(validEdge, "create")).toBeNull();
    expect(draftToScriptCreatePayload(validEdge)).toEqual({
      key: "edge_key",
      name: { en: "n".repeat(500), ru: "и".repeat(500) },
      description: { en: "d".repeat(2_000), ru: "о".repeat(2_000) },
      category: "c".repeat(64),
      icon: "i".repeat(64),
      color: "f".repeat(32),
      displayOrder: -1_000_000
    });

    for (const [invalid, expected] of [
      [{ ...base, id: null, key: "  " }, "invalidKey"],
      [{ ...base, nameEn: " " }, "localizedName"],
      [{ ...base, nameEn: "n".repeat(501) }, "localizedName"],
      [{ ...base, descriptionRu: " " }, "localizedDescription"],
      [{ ...base, descriptionRu: "о".repeat(2_001) }, "localizedDescription"],
      [{ ...base, category: " " }, "category"],
      [{ ...base, category: "c".repeat(65) }, "category"],
      [{ ...base, icon: " " }, "icon"],
      [{ ...base, icon: "i".repeat(65) }, "icon"],
      [{ ...base, color: " " }, "color"],
      [{ ...base, color: "f".repeat(33) }, "color"],
      [{ ...base, displayOrder: "" }, "displayOrder"],
      [{ ...base, displayOrder: "1.5" }, "displayOrder"],
      [{ ...base, displayOrder: "-1000001" }, "displayOrder"],
      [{ ...base, displayOrder: "1000001" }, "displayOrder"]
    ] as const) {
      expect(validateScriptDraft(invalid, invalid.id === null ? "create" : "update")).toBe(
        expected
      );
    }
  });

  it("round-trips a version draft and rejects invalid JSON", () => {
    const draft = versionToDraft(createVersion());
    expect(draft.runtime).toBe("python3");
    expect(draft.browserCapabilityEnabled).toBe(false);
    expect(validateVersionDraftJson(draft)).toBeNull();

    const payload = draftToVersionWritePayload(draft);
    expect(payload.runtime).toBe("python3");
    expect(payload.manifest.schemaVersion).toBe(1);
    expect(payload.manifest.capabilities).toBeUndefined();

    expect(validateVersionDraftJson({ ...draft, inputSchemaJson: "{not json" })).toBe(
      "invalidJson"
    );
    expect(validateVersionDraftJson({ ...draft, code: "" })).toBe("invalidJson");
    expect(validateVersionDraftJson({ ...draft, timeoutMs: "abc" })).toBe("invalidJson");
  });

  it("round-trips exact browser capability and requires string profile input", () => {
    const browserVersion = createVersion({
      manifest: {
        schemaVersion: 1,
        workingDirectory: null,
        environment: {},
        capabilities: { browser: { actions: ["snapshot", "act"] } }
      },
      inputSchema: {
        type: "object",
        properties: { profile: { type: "string" } },
        required: ["profile"],
        additionalProperties: false
      }
    });
    const draft = versionToDraft(browserVersion);
    expect(draft.browserCapabilityEnabled).toBe(true);
    expect(validateVersionDraftJson(draft)).toBeNull();

    const payload = draftToVersionWritePayload(draft);
    expect(payload.manifest.capabilities).toEqual({
      browser: { actions: ["snapshot", "act"] }
    });

    expect(
      validateVersionDraftJson({
        ...draft,
        inputSchemaJson: JSON.stringify({ type: "object", properties: {}, required: [] })
      })
    ).toBe("browserProfileRequired");
    expect(
      validateVersionDraftJson({
        ...draft,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: { profile: { type: "number" } },
          required: ["profile"]
        })
      })
    ).toBe("browserProfileRequired");
    expect(
      validateVersionDraftJson({
        ...draft,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: { profile: { type: "string" } },
          required: []
        })
      })
    ).toBe("browserProfileRequired");

    const withoutCapability = draftToVersionWritePayload({
      ...draft,
      browserCapabilityEnabled: false
    });
    expect(withoutCapability.manifest.capabilities).toBeUndefined();

    expect(
      versionToDraft(
        createVersion({
          manifest: {
            schemaVersion: 1,
            workingDirectory: null,
            environment: {},
            capabilities: { browser: { actions: ["act", "snapshot"] } } as never
          }
        })
      ).browserCapabilityEnabled
    ).toBe(false);
  });

  it("pins canonical ScriptVersion authoring bounds and valid edges", () => {
    const draft = versionToDraft(createVersion());
    const validEnvironment = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`KEY_${String(index)}`, "x".repeat(4_096)])
    );
    const validEdge = {
      ...draft,
      code: "x",
      workingDirectory: `  ${"w".repeat(512)}  `,
      environmentJson: JSON.stringify(validEnvironment),
      runtime: `r${"a".repeat(63)}`,
      entryCommand: "x".repeat(4_096),
      timeoutMs: "100",
      maxMemoryMb: "16",
      maxCpuMillicores: "10",
      maxOutputBytes: "1"
    };
    expect(validateVersionDraftJson(validEdge)).toBeNull();
    expect(draftToVersionWritePayload(validEdge).manifest).toEqual({
      schemaVersion: 1,
      workingDirectory: "w".repeat(512),
      environment: validEnvironment
    });

    for (const invalid of [
      { ...draft, code: "" },
      { ...draft, code: "x".repeat(1_000_001) },
      { ...draft, runtime: "Python3" },
      { ...draft, runtime: `r${"a".repeat(64)}` },
      { ...draft, entryCommand: "" },
      { ...draft, entryCommand: "x".repeat(4_097) },
      { ...draft, workingDirectory: "x".repeat(513) },
      { ...draft, workingDirectory: "   " },
      {
        ...draft,
        environmentJson: JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`KEY_${String(index)}`, "x"])
          )
        )
      },
      { ...draft, environmentJson: JSON.stringify({ lowercase: "x" }) },
      { ...draft, environmentJson: JSON.stringify({ PERSAI_SCRIPT_ENTRY_PATH: "x" }) },
      { ...draft, environmentJson: JSON.stringify({ KEY: "x".repeat(4_097) }) },
      { ...draft, environmentJson: JSON.stringify({ KEY: 1 }) },
      { ...draft, timeoutMs: "99" },
      { ...draft, timeoutMs: "1800001" },
      { ...draft, maxMemoryMb: "15" },
      { ...draft, maxMemoryMb: "32769" },
      { ...draft, maxCpuMillicores: "9" },
      { ...draft, maxCpuMillicores: "16001" },
      { ...draft, maxOutputBytes: "0" },
      { ...draft, maxOutputBytes: "100000001" },
      { ...draft, inputSchemaJson: JSON.stringify({ type: "string" }) },
      { ...draft, inputSchemaJson: JSON.stringify({ type: "object", $ref: "https://remote" }) },
      { ...draft, outputSchemaJson: JSON.stringify({ type: "not-a-json-schema-type" }) },
      {
        ...draft,
        outputSchemaJson: JSON.stringify({ type: "object", description: "x".repeat(65_536) })
      }
    ]) {
      expect(validateVersionDraftJson(invalid)).toBe("invalidJson");
    }

    let deepSchema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 17; index += 1) {
      deepSchema = { allOf: [deepSchema] };
    }
    expect(
      validateVersionDraftJson({ ...draft, outputSchemaJson: JSON.stringify(deepSchema) })
    ).toBe("invalidJson");
  });
});

describe("AdminScriptsPage integration", () => {
  it("renders EN and RU catalogs and performs initial Script/Skill loads", async () => {
    const first = renderPage("en");
    expect(screen.getByText("Loading Scripts…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Scripts" })).toBeInTheDocument();
    expect(await screen.findByText("Send report")).toBeInTheDocument();
    expect(api.getAdminScripts).toHaveBeenCalledWith("token");
    expect(api.getAdminSkills).toHaveBeenCalledWith("token");

    first.unmount();
    renderPage("ru");
    expect(await screen.findByRole("heading", { name: "Скрипты" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Новый скрипт" })).toBeInTheDocument();
  }, 15_000);

  it("creates a Script with the exact immutable key and localized core payload", async () => {
    renderPage("en");
    await screen.findByText("Send report");
    fireEvent.click(screen.getByRole("button", { name: "New script" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Key/ }), {
      target: { value: "new_script" }
    });
    fireEvent.change(screen.getByLabelText("Name (EN)"), { target: { value: "New Script" } });
    fireEvent.change(screen.getByLabelText("Name (RU)"), { target: { value: "Новый скрипт" } });
    fireEvent.change(screen.getByLabelText("Description (EN)"), {
      target: { value: "Does something." }
    });
    fireEvent.change(screen.getByLabelText("Description (RU)"), {
      target: { value: "Делает что-то." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.createAdminScript).toHaveBeenCalledWith("token", {
        key: "new_script",
        name: { en: "New Script", ru: "Новый скрипт" },
        description: { en: "Does something.", ru: "Делает что-то." },
        category: "general",
        icon: null,
        color: null,
        displayOrder: 100
      })
    );
  });

  it("creates a draft version by copying the last published version, not empty boilerplate", async () => {
    const publishedCode =
      'import json, os\nresult = {"echo": True}\njson.dump(result, open(os.environ["PERSAI_SCRIPT_OUTPUT_PATH"], "w"))\n';
    const published = createVersion({
      id: "00000000-0000-4000-8000-000000000699",
      status: "published",
      version: 1,
      code: publishedCode,
      contentHash: "abc123",
      publishedAt: "2026-07-17T01:00:00.000Z",
      limits: {
        timeoutMs: 12_000,
        maxMemoryMb: 128,
        maxCpuMillicores: 250,
        maxOutputBytes: 32_768
      },
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false
      }
    });
    api.getAdminScripts.mockResolvedValue([
      createScript({
        status: "published",
        currentPublishedVersionId: published.id
      })
    ]);
    api.getAdminScriptVersions.mockResolvedValue([published]);
    api.createAdminScriptVersion.mockResolvedValue(
      createVersion({
        id: "00000000-0000-4000-8000-000000000700",
        status: "draft",
        version: 2,
        code: publishedCode
      })
    );

    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Send report/ }));
    expect(
      await screen.findByText("No draft version. Create one to author code.")
    ).toBeInTheDocument();
    await waitFor(() => {
      const codeField = screen.getByRole("textbox", { name: /^Code$/i });
      expect(codeField).toHaveValue(publishedCode);
    });

    fireEvent.click(screen.getByRole("button", { name: "New draft version" }));

    await waitFor(() => expect(api.createAdminScriptVersion).toHaveBeenCalledTimes(1));
    const call = api.createAdminScriptVersion.mock.calls[0];
    expect(call).toBeDefined();
    const [, scriptId, payload] = call ?? [];
    expect(scriptId).toBe("00000000-0000-4000-8000-000000000501");
    expect(payload.code).toBe(publishedCode);
    expect(payload.limits).toEqual(published.limits);
    expect(payload.inputSchema).toEqual(published.inputSchema);
    expect(payload.entryCommand).toBe('python3 "$PERSAI_SCRIPT_ENTRY_PATH"');
    expect(await screen.findByText("Draft version created.")).toBeInTheDocument();
  });

  it("resolveVersionEditorSeed prefers draft, else published, else empty boilerplate", () => {
    const published = createVersion({
      id: "pub-1",
      status: "published",
      code: "published_code",
      version: 1
    });
    const draft = createVersion({
      id: "draft-1",
      status: "draft",
      code: "draft_code",
      version: 2
    });
    expect(resolveVersionEditorSeed([published, draft], published.id).code).toBe("draft_code");
    expect(resolveVersionEditorSeed([published], published.id).code).toBe("published_code");
    expect(seedDraftCreateFromPublished([published], published.id)).toMatchObject({
      code: "published_code",
      id: null,
      status: null,
      revision: null,
      contentHash: null,
      publishedAt: null
    });
    expect(resolveVersionEditorSeed([], null).code).toContain("PERSAI_SCRIPT_INPUT_PATH");
  });

  it("loads browser capability into the draft and preserves it on save", async () => {
    const browserInputSchema = {
      type: "object",
      properties: { profile: { type: "string" } },
      required: ["profile"],
      additionalProperties: false
    };
    api.getAdminScriptVersions.mockResolvedValue([
      createVersion({
        manifest: {
          schemaVersion: 1,
          workingDirectory: null,
          environment: {},
          capabilities: { browser: { actions: ["snapshot", "act"] } }
        },
        inputSchema: browserInputSchema
      })
    ]);
    api.updateAdminScriptVersion.mockImplementation(
      async (_token, _scriptId, _versionId, payload) => ({
        ...createVersion(),
        ...payload,
        revision: 2
      })
    );
    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Send report/ }));
    const checkbox = await screen.findByRole("checkbox", {
      name: /Browser capability \(snapshot \+ act\)/
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.updateAdminScriptVersion).toHaveBeenCalledTimes(1));
    const [, , , payload] = api.updateAdminScriptVersion.mock.calls[0] ?? [];
    expect(payload.manifest.capabilities).toEqual({
      browser: { actions: ["snapshot", "act"] }
    });
    expect(payload.inputSchema).toEqual(browserInputSchema);
  });

  it("persists the exact visible draft before validating it", async () => {
    const saved = createVersion({ code: "print('visible validate edit')", revision: 2 });
    api.getAdminScriptVersions.mockResolvedValue([createVersion()]);
    api.updateAdminScriptVersion.mockResolvedValue(saved);
    api.validateAdminScriptVersion.mockResolvedValue(saved);
    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Send report/ }));
    await screen.findByRole("button", { name: "Validate" });

    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "print('visible validate edit')" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    await waitFor(() => expect(api.validateAdminScriptVersion).toHaveBeenCalledTimes(1));
    expect(api.updateAdminScriptVersion).toHaveBeenCalledWith(
      "token",
      "00000000-0000-4000-8000-000000000501",
      "00000000-0000-4000-8000-000000000601",
      {
        code: "print('visible validate edit')",
        manifest: { schemaVersion: 1, workingDirectory: null, environment: {} },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        runtime: "python3",
        entryCommand: 'python3 "$PERSAI_SCRIPT_ENTRY_PATH"',
        limits: {
          timeoutMs: 5_000,
          maxMemoryMb: 256,
          maxCpuMillicores: 500,
          maxOutputBytes: 65_536
        },
        expectedRevision: 1
      }
    );
    expect(api.validateAdminScriptVersion).toHaveBeenCalledWith(
      "token",
      "00000000-0000-4000-8000-000000000501",
      saved.id
    );
    expect(api.updateAdminScriptVersion.mock.invocationCallOrder[0]).toBeLessThan(
      api.validateAdminScriptVersion.mock.invocationCallOrder[0]!
    );
  });

  it("persists the exact visible draft before publishing with the returned revision", async () => {
    const saved = createVersion({ code: "print('visible publish edit')", revision: 7 });
    api.getAdminScriptVersions.mockResolvedValue([createVersion()]);
    api.updateAdminScriptVersion.mockResolvedValue(saved);
    api.publishAdminScriptVersion.mockResolvedValue({
      script: createScript({ status: "published", currentPublishedVersionId: saved.id }),
      version: createVersion({
        code: saved.code,
        revision: saved.revision,
        status: "published",
        publishedAt: "2026-07-17T01:00:00.000Z"
      })
    });
    renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: /Send report/ }));
    await screen.findByRole("button", { name: "Publish" });

    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "print('visible publish edit')" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(api.publishAdminScriptVersion).toHaveBeenCalledTimes(1));
    expect(api.updateAdminScriptVersion).toHaveBeenCalledWith(
      "token",
      "00000000-0000-4000-8000-000000000501",
      "00000000-0000-4000-8000-000000000601",
      {
        code: "print('visible publish edit')",
        manifest: { schemaVersion: 1, workingDirectory: null, environment: {} },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        runtime: "python3",
        entryCommand: 'python3 "$PERSAI_SCRIPT_ENTRY_PATH"',
        limits: {
          timeoutMs: 5_000,
          maxMemoryMb: 256,
          maxCpuMillicores: 500,
          maxOutputBytes: 65_536
        },
        expectedRevision: 1
      }
    );
    expect(api.publishAdminScriptVersion).toHaveBeenCalledWith(
      "token",
      "00000000-0000-4000-8000-000000000501",
      saved.id,
      { expectedRevision: 7 }
    );
    expect(api.updateAdminScriptVersion.mock.invocationCallOrder[0]).toBeLessThan(
      api.publishAdminScriptVersion.mock.invocationCallOrder[0]!
    );
  });

  it("ignores an out-of-order version response from an earlier Script selection", async () => {
    const firstScript = createScript();
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" }
    });
    const firstResponse = deferred<ScriptVersionState[]>();
    const secondResponse = deferred<ScriptVersionState[]>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminScriptVersions.mockImplementation(async (_token, scriptId) =>
      scriptId === firstScript.id ? firstResponse.promise : secondResponse.promise
    );
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    await waitFor(() => expect(api.getAdminScriptVersions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Other script/ }));
    await waitFor(() => expect(api.getAdminScriptVersions).toHaveBeenCalledTimes(2));
    secondResponse.resolve([createVersion({ scriptId: secondScript.id, code: "print('second')" })]);
    await waitFor(() => expect(screen.getByLabelText("Code")).toHaveValue("print('second')"));

    firstResponse.resolve([createVersion({ scriptId: firstScript.id, code: "print('first')" })]);
    await Promise.resolve();
    expect(screen.getByLabelText("Code")).toHaveValue("print('second')");
    expect(screen.getByRole("button", { name: /Other script/ }).className).toContain(
      "bg-accent/10"
    );
  });

  it("keeps version controls hidden until the current selection load settles", async () => {
    const firstScript = createScript();
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" }
    });
    const firstResponse = deferred<ScriptVersionState[]>();
    const secondResponse = deferred<ScriptVersionState[]>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminScriptVersions.mockImplementation(async (_token, scriptId) =>
      scriptId === firstScript.id ? firstResponse.promise : secondResponse.promise
    );
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    await screen.findByText("Loading versions…");
    expect(screen.queryByRole("button", { name: "New draft version" })).not.toBeInTheDocument();
    await waitFor(() => expect(api.getAdminScriptVersions).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Other script/ }));
    await waitFor(() => expect(api.getAdminScriptVersions).toHaveBeenCalledTimes(2));
    firstResponse.resolve([]);
    await Promise.resolve();
    expect(screen.getByText("Loading versions…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New draft version" })).not.toBeInTheDocument();

    secondResponse.resolve([]);
    expect(await screen.findByRole("button", { name: "New draft version" })).toBeInTheDocument();
    expect(screen.queryByText("Loading versions…")).not.toBeInTheDocument();
  });

  it("ignores a stale draft-save response after selecting another Script", async () => {
    const firstScript = createScript();
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" }
    });
    const saveResponse = deferred<ScriptVersionState>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminScriptVersions.mockImplementation(async (_token, scriptId) => [
      createVersion({
        scriptId,
        id:
          scriptId === firstScript.id
            ? "00000000-0000-4000-8000-000000000601"
            : "00000000-0000-4000-8000-000000000602",
        code: scriptId === firstScript.id ? "print('first')" : "print('second')"
      })
    ]);
    api.updateAdminScriptVersion.mockReturnValue(saveResponse.promise);
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    await waitFor(() => expect(screen.getByLabelText("Code")).toHaveValue("print('first')"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.updateAdminScriptVersion).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Other script/ }));
    await waitFor(() => expect(screen.getByLabelText("Code")).toHaveValue("print('second')"));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();

    saveResponse.resolve(createVersion({ code: "print('stale saved first')", revision: 2 }));
    await Promise.resolve();
    expect(screen.getByLabelText("Code")).toHaveValue("print('second')");
    expect(screen.queryByText("Draft version saved.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it("ignores an out-of-order bindings response from an earlier Skill selection", async () => {
    const firstScript = createScript({
      status: "published",
      currentPublishedVersionId: "version-1"
    });
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" },
      status: "published",
      currentPublishedVersionId: "version-2"
    });
    const firstResponse = deferred<Array<{ scriptId: string }>>();
    const secondResponse = deferred<Array<{ scriptId: string }>>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminSkills.mockResolvedValue([skillOne, skillTwo]);
    api.getAdminSkillScripts.mockImplementation(async (_token, selectedSkillId) =>
      selectedSkillId === skillOne.id ? firstResponse.promise : secondResponse.promise
    );
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: skillOne.id } });
    await waitFor(() => expect(api.getAdminSkillScripts).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: skillTwo.id } });
    await waitFor(() => expect(api.getAdminSkillScripts).toHaveBeenCalledTimes(2));
    secondResponse.resolve([{ scriptId: secondScript.id }]);
    await waitFor(() => expect(screen.getByLabelText("Link Script: Other script")).toBeChecked());

    firstResponse.resolve([{ scriptId: firstScript.id }]);
    await Promise.resolve();
    expect(screen.getByLabelText("Link Script: Other script")).toBeChecked();
    expect(screen.getByLabelText("Link Script: Send report")).not.toBeChecked();
    expect(screen.getByLabelText("Skill")).toHaveValue(skillTwo.id);
  });

  it("ignores a stale binding-save response after selecting another Skill", async () => {
    const firstScript = createScript({
      status: "published",
      currentPublishedVersionId: "version-1"
    });
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" },
      status: "published",
      currentPublishedVersionId: "version-2"
    });
    const saveResponse = deferred<Array<{ scriptId: string }>>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminSkills.mockResolvedValue([skillOne, skillTwo]);
    api.getAdminSkillScripts.mockImplementation(async (_token, selectedSkillId) =>
      selectedSkillId === skillOne.id
        ? [{ scriptId: firstScript.id }]
        : [{ scriptId: secondScript.id }]
    );
    api.replaceAdminSkillScripts.mockReturnValue(saveResponse.promise);
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: skillOne.id } });
    await waitFor(() => expect(screen.getByLabelText("Link Script: Send report")).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Save bindings" }));
    await waitFor(() => expect(api.replaceAdminSkillScripts).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: skillTwo.id } });
    await waitFor(() => expect(screen.getByLabelText("Link Script: Other script")).toBeChecked());
    expect(screen.getByRole("button", { name: "Save bindings" })).toBeEnabled();

    saveResponse.resolve([{ scriptId: firstScript.id }]);
    await Promise.resolve();
    expect(screen.getByLabelText("Link Script: Other script")).toBeChecked();
    expect(screen.getByLabelText("Link Script: Send report")).not.toBeChecked();
    expect(screen.queryByText("Skill Script bindings updated.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save bindings" })).toBeEnabled();
  });

  it("locks all binding controls until full-replace returns server order", async () => {
    const firstScript = createScript({
      status: "published",
      currentPublishedVersionId: "version-1"
    });
    const secondScript = createScript({
      id: "00000000-0000-4000-8000-000000000502",
      key: "other_script",
      name: { en: "Other script", ru: "Другой скрипт" },
      status: "published",
      currentPublishedVersionId: "version-2"
    });
    const saveResponse = deferred<Array<{ scriptId: string }>>();
    api.getAdminScripts.mockResolvedValue([firstScript, secondScript]);
    api.getAdminSkillScripts.mockResolvedValue([
      { scriptId: firstScript.id },
      { scriptId: secondScript.id }
    ]);
    api.replaceAdminSkillScripts.mockReturnValue(saveResponse.promise);
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: skillOne.id } });
    const firstCheckbox = await screen.findByLabelText("Link Script: Send report");
    const secondCheckbox = screen.getByLabelText("Link Script: Other script");
    const firstRow = firstCheckbox.closest("li");
    const secondRow = secondCheckbox.closest("li");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();
    expect(within(firstRow!).getByText("1")).toBeInTheDocument();
    expect(within(secondRow!).getByText("2")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save bindings" });
    fireEvent.click(saveButton);
    await waitFor(() => expect(api.replaceAdminSkillScripts).toHaveBeenCalledTimes(1));

    const upButtons = screen.getAllByRole("button", { name: "↑" });
    const downButtons = screen.getAllByRole("button", { name: "↓" });
    expect(firstCheckbox).toBeDisabled();
    expect(secondCheckbox).toBeDisabled();
    expect(saveButton).toBeDisabled();
    for (const button of [...upButtons, ...downButtons]) {
      expect(button).toBeDisabled();
    }

    firstCheckbox.click();
    downButtons[0]!.click();
    saveButton.click();
    expect(api.replaceAdminSkillScripts).toHaveBeenCalledTimes(1);
    expect(firstCheckbox).toBeChecked();
    expect(within(firstRow!).getByText("1")).toBeInTheDocument();

    saveResponse.resolve([{ scriptId: secondScript.id }, { scriptId: firstScript.id }]);
    await waitFor(() => expect(saveButton).toBeEnabled());
    expect(firstCheckbox).toBeEnabled();
    expect(secondCheckbox).toBeEnabled();
    for (const button of [...upButtons, ...downButtons]) {
      expect(button).toBeEnabled();
    }
    expect(within(firstRow!).getByText("2")).toBeInTheDocument();
    expect(within(secondRow!).getByText("1")).toBeInTheDocument();
  });

  it("saves a Skill's ordered Script bindings via full replace", async () => {
    api.getAdminScripts.mockResolvedValue([
      createScript({ status: "published", currentPublishedVersionId: "v1" })
    ]);
    renderPage("en");
    await screen.findByText("Send report");

    fireEvent.change(screen.getByLabelText("Skill"), {
      target: { value: skillOne.id }
    });

    await waitFor(() =>
      expect(api.getAdminSkillScripts).toHaveBeenCalledWith("token", skillOne.id)
    );
    fireEvent.click(screen.getByLabelText("Link Script: Send report"));
    fireEvent.click(screen.getByRole("button", { name: "Save bindings" }));

    await waitFor(() =>
      expect(api.replaceAdminSkillScripts).toHaveBeenCalledWith("token", skillOne.id, {
        scriptIds: ["00000000-0000-4000-8000-000000000501"]
      })
    );
    expect(await screen.findByText("Skill Script bindings updated.")).toBeInTheDocument();
  });

  it("surfaces the localized key-conflict error on create", async () => {
    const { ContractsApiError } = await import("@persai/contracts");
    api.createAdminScript.mockRejectedValueOnce(
      new ContractsApiError("conflict", 409, {}, "admin_script_key_conflict")
    );
    renderPage("en");
    await screen.findByText("Send report");
    fireEvent.click(screen.getByRole("button", { name: "New script" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Key/ }), {
      target: { value: "dup_key" }
    });
    fireEvent.change(screen.getByLabelText("Name (EN)"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Name (RU)"), { target: { value: "Дубль" } });
    fireEvent.change(screen.getByLabelText("Description (EN)"), { target: { value: "Dup." } });
    fireEvent.change(screen.getByLabelText("Description (RU)"), { target: { value: "Дубль." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This Script key is already in use.")).toBeInTheDocument();
  });
});
