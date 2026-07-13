import {
  DEFAULT_ASSISTANT_ROLE_CREATE,
  DEFAULT_ASSISTANT_ROLE_ID,
  DEFAULT_ASSISTANT_ROLE_KEY
} from "./assistant-role-seed-data";

type AssistantRoleBootstrapClient = {
  assistantRole: {
    upsert(args: {
      where: { id: string };
      update: Record<string, never>;
      create: typeof DEFAULT_ASSISTANT_ROLE_CREATE;
      select: { id: true; key: true };
    }): Promise<{ id: string; key: string }>;
  };
};

export async function ensureDefaultAssistantRole(
  client: AssistantRoleBootstrapClient
): Promise<void> {
  const role = await client.assistantRole.upsert({
    where: { id: DEFAULT_ASSISTANT_ROLE_ID },
    update: {},
    create: DEFAULT_ASSISTANT_ROLE_CREATE,
    select: { id: true, key: true }
  });
  if (role.id !== DEFAULT_ASSISTANT_ROLE_ID || role.key !== DEFAULT_ASSISTANT_ROLE_KEY) {
    throw new Error("Default Assistant Role identity does not match the canonical id/key.");
  }
}
