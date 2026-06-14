import { createDecipheriv, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

async function decryptOpenAiKey(prisma) {
  const masterKey = process.env.RUNTIME_PROVIDER_SECRETS_MASTER_KEY?.trim();
  if (!masterKey) {
    throw new Error("RUNTIME_PROVIDER_SECRETS_MASTER_KEY is not configured.");
  }
  const derived = createHash("sha256").update(masterKey).digest();
  const row = await prisma.platformRuntimeProviderSecret.findUnique({
    where: { providerKey: "openai" }
  });
  if (row === null) {
    throw new Error("Platform OpenAI provider key is not configured.");
  }
  const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function summarizeScores(scores) {
  return Object.entries(scores ?? {})
    .filter(([, value]) => value > 0.01)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([category, score]) => ({ category, score: Number(score.toFixed(4)) }));
}

async function moderate({ apiKey, model, text }) {
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input: text })
  });
  const body = await response.json();
  return { response, body };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const settings = await prisma.safetyPolicySettings.findFirst({
      select: {
        moderationModelId: true,
        contour2Enabled: true,
        syncHoldTimeoutMs: true
      }
    });
    console.log(
      JSON.stringify(
        {
          step: "safety_policy_settings",
          ok: settings !== null,
          settings: settings ?? null
        },
        null,
        2
      )
    );

    const openaiMeta = await prisma.platformRuntimeProviderSecret.findUnique({
      where: { providerKey: "openai" },
      select: { lastFour: true, updatedAt: true }
    });
    console.log(
      JSON.stringify(
        {
          step: "openai_provider_key",
          configured: openaiMeta !== null,
          lastFour: openaiMeta?.lastFour ?? null,
          updatedAt: openaiMeta?.updatedAt?.toISOString() ?? null
        },
        null,
        2
      )
    );

    const recentJobs = await prisma.safetyModerationReviewJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        surface: true,
        createdAt: true,
        updatedAt: true
      }
    });
    console.log(
      JSON.stringify(
        {
          step: "recent_moderation_jobs",
          count: recentJobs.length,
          jobs: recentJobs
        },
        null,
        2
      )
    );

    const recentCases = await prisma.moderationCase.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        decision: true,
        reasonCode: true,
        scores: true,
        createdAt: true
      }
    });
    console.log(
      JSON.stringify(
        {
          step: "recent_moderation_cases",
          count: recentCases.length,
          cases: recentCases
        },
        null,
        2
      )
    );

    const model = settings?.moderationModelId ?? "omni-moderation-latest";
    const apiKey = await decryptOpenAiKey(prisma);
    const samples = [
      ["benign", "Hello, how is the weather today?"],
      ["violence_sample", "I want to kill everyone in that building"]
    ];

    for (const [label, text] of samples) {
      const { response, body } = await moderate({ apiKey, model, text });
      const result = body.results?.[0];
      console.log(
        JSON.stringify(
          {
            step: `moderation_live_${label}`,
            httpStatus: response.status,
            model,
            ok: response.ok,
            flagged: result?.flagged ?? null,
            flaggedCategories: Object.entries(result?.categories ?? {})
              .filter(([, flagged]) => flagged === true)
              .map(([category]) => category),
            topScores: summarizeScores(result?.category_scores),
            error: response.ok ? null : body
          },
          null,
          2
        )
      );
      if (!response.ok) {
        throw new Error(`Moderation API failed for sample ${label} (${response.status}).`);
      }
    }

    console.log(JSON.stringify({ step: "direct_api_done", ok: true }, null, 2));

    const assistant = await prisma.assistant.findFirst({
      select: {
        id: true,
        userId: true,
        workspaceId: true
      },
      orderBy: { createdAt: "desc" }
    });
    if (assistant === null) {
      throw new Error("No assistant found for worker-path smoke test.");
    }

    const triggerKey = `live-smoke:${Date.now()}`;
    const triggerText = "Live smoke test message for moderation worker path";
    const job = await prisma.safetyModerationReviewJob.create({
      data: {
        triggerKey,
        userId: assistant.userId,
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        chatId: null,
        surface: "web_chat",
        surfaceThreadKey: null,
        messageSnapshot: {
          triggerText,
          textLength: triggerText.length,
          hasText: true
        },
        precheckOutcome: {
          route: "defer_contour_2",
          rulePack: null,
          matchedSignals: [],
          score: 0
        },
        status: "pending"
      },
      select: { id: true, triggerKey: true, status: true }
    });
    console.log(JSON.stringify({ step: "worker_job_enqueued", job }, null, 2));

    let finalJob = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      finalJob = await prisma.safetyModerationReviewJob.findUnique({
        where: { id: job.id },
        select: { id: true, status: true, updatedAt: true }
      });
      if (finalJob?.status === "completed" || finalJob?.status === "failed") {
        break;
      }
    }
    console.log(JSON.stringify({ step: "worker_job_final", job: finalJob }, null, 2));

    const moderationCase = await prisma.$queryRaw`
      SELECT id, decision, reason_code AS "reasonCode", scores, created_at AS "createdAt"
      FROM moderation_cases
      WHERE user_id = ${assistant.userId}::uuid
        AND trigger_snapshot->>'triggerKey' = ${triggerKey}
      LIMIT 1
    `;
    console.log(
      JSON.stringify(
        {
          step: "worker_moderation_case",
          case: moderationCase[0] ?? null
        },
        null,
        2
      )
    );

    if (finalJob?.status !== "completed") {
      throw new Error(`Worker job did not complete (status=${finalJob?.status ?? "missing"}).`);
    }
    if (!moderationCase[0]) {
      throw new Error("Worker job completed but moderation case was not created.");
    }

    console.log(JSON.stringify({ step: "done", ok: true }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      step: "failed",
      message: error instanceof Error ? error.message : String(error)
    })
  );
  process.exit(1);
});
