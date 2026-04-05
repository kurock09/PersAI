import { PrismaService } from "../../../identity-access/infrastructure/persistence/prisma.service";

// Workspace-management keeps its own injection token, but it now aliases the
// shared identity-access Prisma singleton instead of opening a second client/pool.
export abstract class WorkspaceManagementPrismaService extends PrismaService {}
