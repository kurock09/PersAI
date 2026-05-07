const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const assistantId = process.argv[2];

if (!assistantId) {
  console.error("assistantId argument is required");
  process.exit(1);
}

async function main() {
  const rows = await prisma.assistantChatMessage.findMany({
    where: { assistantId },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      chatId: true,
      author: true,
      content: true,
      createdAt: true
    }
  });

  const filtered = rows.filter((row) =>
    /фонов|background|тихо|через 2 минут|проверь|later|remind|ping/i.test(row.content)
  );

  console.log(JSON.stringify(filtered, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
