const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const jobId = process.argv[2];

if (!jobId) {
  console.error("jobId argument is required");
  process.exit(1);
}

async function main() {
  const job = await prisma.assistantMediaJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      assistantId: true,
      workspaceId: true,
      chatId: true,
      surface: true,
      kind: true,
      sourceUserMessageId: true,
      requestJson: true
    }
  });

  if (!job || !job.requestJson || !job.sourceUserMessageId) {
    throw new Error("Job or request payload not found.");
  }

  const spec = await prisma.assistantMaterializedSpec.findFirst({
    where: { assistantId: job.assistantId },
    orderBy: [{ createdAt: "desc" }],
    select: { runtimeBundleDocument: true }
  });

  if (!spec?.runtimeBundleDocument) {
    throw new Error("runtimeBundleDocument not found.");
  }

  const requestJson = job.requestJson;
  const input = {
    assistantId: job.assistantId,
    workspaceId: job.workspaceId,
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: spec.runtimeBundleDocument,
    job: {
      id: job.id,
      surface: job.surface,
      kind: job.kind,
      chatId: job.chatId,
      sourceUserMessageId: job.sourceUserMessageId,
      sourceUserMessageText: requestJson.sourceUserMessageText,
      sourceUserMessageCreatedAt: requestJson.sourceUserMessageCreatedAt
    },
    attachments: requestJson.attachments,
    directToolExecution: requestJson.directToolExecution
  };

  const baseUrl = process.env.PERSAI_RUNTIME_BASE_URL;
  const token = process.env.PERSAI_INTERNAL_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("Runtime base URL or token missing from env.");
  }

  const response = await fetch(new URL("/api/v1/internal/runtime/media-jobs/run", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const text = await response.text();
  console.log(
    JSON.stringify(
      {
        status: response.status,
        ok: response.ok,
        body: text
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
