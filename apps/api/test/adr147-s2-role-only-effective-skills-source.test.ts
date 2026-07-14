import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const applicationRoot = new URL(
  "../src/modules/workspace-management/application/",
  import.meta.url
);

async function source(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(name, applicationRoot)), "utf8");
}

async function run(): Promise<void> {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const [
    materialize,
    preview,
    ensureCurrent,
    materializationVersion,
    mutationLocks,
    knowledge,
    adminSkills,
    scenarios,
    roleManagement,
    internalSkillState,
    legacyManagement,
    contractPackage,
    contractOpenApi,
    contractFormatter
  ] = await Promise.all([
    source("materialize-assistant-published-version.service.ts"),
    source("preview-assistant-setup.service.ts"),
    source("ensure-assistant-materialized-spec-current.service.ts"),
    source("assistant-materialization-version.ts"),
    source("assistant-skill-mutation-locks.ts"),
    source("read-assistant-knowledge.service.ts"),
    source("manage-admin-skills.service.ts"),
    source("manage-skill-scenarios.service.ts"),
    source("manage-assistant-roles.service.ts"),
    source("internal-runtime-skill-state.service.ts"),
    source("manage-assistant-skills.service.ts"),
    readFile(fileURLToPath(new URL("packages/contracts/package.json", repositoryRoot)), "utf8"),
    readFile(fileURLToPath(new URL("packages/contracts/openapi.yaml", repositoryRoot)), "utf8"),
    readFile(
      fileURLToPath(new URL("packages/contracts/scripts/prettier-write-retry.mjs", repositoryRoot)),
      "utf8"
    )
  ]);

  for (const [name, text] of [
    ["materialization", materialize],
    ["Skill Knowledge authorization", knowledge],
    ["admin Skill invalidation", adminSkills],
    ["scenario invalidation", scenarios]
  ] as const) {
    assert.doesNotMatch(
      text,
      /assistantSkillAssignment/,
      `${name} must not read or mutate legacy AssistantSkillAssignment`
    );
  }

  assert.match(materialize, /assistantRoleSkill\.findMany/);
  assert.match(materialize, /roleId: params\.assistant\.roleId/);
  assert.match(materialize, /effectiveRoleId: assistant\.roleId/);
  assert.match(materializationVersion, /CURRENT_ASSISTANT_MATERIALIZATION_ALGORITHM_VERSION = 2/);
  assert.match(materialize, /CURRENT_ASSISTANT_MATERIALIZATION_ALGORITHM_VERSION/);
  assert.match(preview, /CURRENT_ASSISTANT_MATERIALIZATION_ALGORITHM_VERSION/);
  assert.match(
    ensureCurrent,
    /algorithmVersion <[\s\S]*CURRENT_ASSISTANT_MATERIALIZATION_ALGORITHM_VERSION/
  );
  assert.match(materialize, /const observedConfigDirtyAt = assistant\.configDirtyAt \?\? null/);
  assert.match(
    materialize,
    /assistant\.updateMany\(\{[\s\S]*configDirtyAt: observedConfigDirtyAt[\s\S]*configDirtyAt: null/
  );
  assert.match(
    ensureCurrent,
    /configDirtyAt\.getTime\(\) >= input\.materializedSpec\.createdAt\.getTime\(\)/
  );
  assert.match(knowledge, /role:\s*\{[\s\S]*skillLinks:/);
  assert.match(adminSkills, /role:\s*\{[\s\S]*skillLinks:/);
  assert.match(adminSkills, /this\.prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(
    adminSkills,
    /lockSkillRow\(tx, skillId\)[\s\S]*assistantRole\.findMany\([\s\S]*lockAssistantRoleRows\([\s\S]*lockRoleSkillRowsForSkill/
  );
  assert.match(mutationLocks, /FROM "skills"[\s\S]*FOR UPDATE/);
  assert.match(
    mutationLocks,
    /"Skill",[\s\S]*"AssistantRole",[\s\S]*"Assistant",[\s\S]*"AssistantChat",[\s\S]*"AssistantRoleSkill"/
  );
  assert.match(
    scenarios,
    /lockSkillRow\(tx, skillId\)[\s\S]*assistantRole\.findMany\([\s\S]*lockAssistantRoleRows\([\s\S]*assistant\.findMany\([\s\S]*lockAssistantRows\([\s\S]*lockAssistantChatRows\([\s\S]*lockRoleSkillRowsForSkill/
  );
  assert.match(scenarios, /this\.prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(scenarios, /skillDecisionState: Prisma\.DbNull/);
  assert.match(scenarios, /skillRetrievalState: Prisma\.DbNull/);
  assert.match(
    roleManagement,
    /lockAssistantRoleRows\([\s\S]*FROM "assistants"[\s\S]*assistant\.roleId !== expectedCurrentRoleId[\s\S]*kind: "retry"/
  );
  assert.match(roleManagement, /MAX_ROLE_ASSIGNMENT_ATTEMPTS = 3/);
  assert.match(
    internalSkillState,
    /requireUuid\([\s\S]*lockSkillRow\([\s\S]*lockAssistantRoleRows\([\s\S]*FROM "assistants"[\s\S]*FROM "assistant_chats"[\s\S]*lockRoleSkillRow/
  );
  assert.match(
    internalSkillState,
    /candidateChat[\s\S]*lockedSkillId !== params\.targetSkillId[\s\S]*RELEASE_CANDIDATE_CHANGED/
  );
  assert.doesNotMatch(contractPackage, /format-generated\.mjs/);
  assert.match(contractPackage, /prettier-write-retry\.mjs src\/generated/);
  assert.equal(
    (contractOpenApi.match(/pendingBrowserLogin:\s+nullable: true\s+allOf:/g) ?? []).length,
    3
  );
  assert.match(contractFormatter, /import \{ format, resolveConfig \} from "prettier"/);
  assert.match(contractFormatter, /process\.argv\[2\]/);
  assert.doesNotMatch(contractFormatter, /pendingBrowserLogin|AssistantWebChat|\.replace\(/);
  assert.doesNotMatch(contractFormatter, /EACCES/);
  assert.match(
    legacyManagement,
    /assistantSkillAssignment/,
    "the retained S2 legacy management endpoint remains its sole explicit writer"
  );
}

void run();
