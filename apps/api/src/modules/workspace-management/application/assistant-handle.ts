import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";

/**
 * ADR-126 Slice 3 — handle generation + per-workspace de-duplication.
 *
 * The handle is the stable, URL/path-safe identifier used to name the
 * per-assistant outbound directory inside session pods
 * (`/shared/<workspaceId>/outbound/<handle>/`) and the corresponding GCS
 * prefix (`workspaces/<workspaceId>/shared/outbound/<handle>/`). Once written
 * at creation time it must remain stable across rename — renaming an
 * assistant does NOT re-slug.
 *
 * The slug algorithm matches the migration backfill in
 * `20260623160000_adr126_slice3_assistant_handle_and_gc_lease/migration.sql`
 * so existing and newly-created rows live in the same namespace.
 */

const HANDLE_MAX_LENGTH = 32;
const HANDLE_COLUMN_MAX_LENGTH = 64;

/** Default fallback when the input string contains no slugifiable ASCII. */
const FALLBACK_PREFIX = "a-";

/**
 * Generate a deterministic slug from a display name. The slug:
 *   * lower-cases the input
 *   * strips diacritics where representable in NFKD
 *   * replaces runs of non-`[a-z0-9]` with a single `-`
 *   * trims leading / trailing `-`
 *   * truncates to {@link HANDLE_MAX_LENGTH} and re-trims trailing `-`
 *   * falls back to `a-<first 8 hex of fallbackSeed>` when the result is
 *     empty. `fallbackSeed` should be the assistant id when available so the
 *     fallback is stable for the row.
 */
export function generateAssistantHandle(
  displayName: string | null | undefined,
  fallbackSeed: string
): string {
  const base = slugify(displayName ?? "");
  if (base.length > 0) {
    return base;
  }
  const seedHex = fallbackSeed.replace(/[^0-9a-f]/gi, "").toLowerCase();
  const tail = (seedHex || "00000000").slice(0, 8).padEnd(8, "0");
  return `${FALLBACK_PREFIX}${tail}`;
}

function slugify(input: string): string {
  const normalised = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/-+$/g, "");
  return normalised;
}

/** Build the `-N` collision-suffix variant of a base handle. */
function applyCollisionSuffix(base: string, n: number): string {
  if (n <= 0) {
    return base;
  }
  const suffix = `-${n}`;
  const room = HANDLE_COLUMN_MAX_LENGTH - suffix.length;
  const trimmed = base.slice(0, Math.max(1, room)).replace(/-+$/g, "");
  const safeBase = trimmed.length > 0 ? trimmed : base.slice(0, 1) || "a";
  return `${safeBase}${suffix}`;
}

/**
 * Minimal Prisma surface we need to look up existing handles inside the
 * caller's transaction. We accept both the root client and the transactional
 * client (`Prisma.TransactionClient`) so callers can de-duplicate inside the
 * same `$transaction` that creates the assistant.
 */
type AssistantHandleLookupClient = {
  assistant: {
    findMany: (args: {
      where: PrismaTypes.AssistantWhereInput;
      select: { handle: true };
    }) => Promise<{ handle: string }[]>;
  };
};

/**
 * Resolve a workspace-unique handle. Looks for existing rows whose handle
 * matches `base` or `base-<N>` and returns the lowest available value. The
 * caller must still rely on the workspace-scoped unique index to detect
 * races; the `(workspaceId, handle)` unique constraint guards correctness if
 * two concurrent inserts both choose the same suffix.
 */
export async function ensureHandleUnique(
  client: AssistantHandleLookupClient,
  workspaceId: string,
  base: string
): Promise<string> {
  const safeBase = base.slice(0, HANDLE_COLUMN_MAX_LENGTH) || `${FALLBACK_PREFIX}00000000`;

  // Pull every existing handle in the workspace that starts with `<base>` so
  // we can compute the next free suffix in O(N) memory without a per-attempt
  // round trip. Workspaces typically host a single-digit number of assistants,
  // so this stays trivially cheap.
  const existing = await client.assistant.findMany({
    where: {
      workspaceId,
      handle: { startsWith: safeBase }
    },
    select: { handle: true }
  });
  const taken = new Set(existing.map((row) => row.handle));

  if (!taken.has(safeBase)) {
    return safeBase;
  }

  for (let n = 1; n < 10_000; n += 1) {
    const candidate = applyCollisionSuffix(safeBase, n);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Extremely unlikely (>10k collisions). Surface a clean error so the create
  // call fails fast rather than silently looping forever.
  throw new Error(
    `ensureHandleUnique exhausted suffixes for base=${safeBase} workspaceId=${workspaceId}`
  );
}

/**
 * Convenience wrapper: derive the base slug from a display name and ensure
 * uniqueness inside the workspace. `fallbackSeed` should be the assistant id
 * the caller has already minted client-side (or any other stable per-row
 * seed); it keeps the fallback deterministic for the row.
 */
export async function buildAssistantHandle(
  client: AssistantHandleLookupClient,
  workspaceId: string,
  displayName: string | null | undefined,
  fallbackSeed: string
): Promise<string> {
  const base = generateAssistantHandle(displayName, fallbackSeed);
  return ensureHandleUnique(client, workspaceId, base);
}

/** Exported for tests. */
export const __ASSISTANT_HANDLE_INTERNALS = {
  slugify,
  applyCollisionSuffix,
  HANDLE_MAX_LENGTH,
  HANDLE_COLUMN_MAX_LENGTH
};

// Re-export `Prisma` so consumers that need the transaction-client type don't
// need to import directly from `@prisma/client` in plain helper modules.
export type AssistantHandleTransactionClient =
  | PrismaTypes.TransactionClient
  | AssistantHandleLookupClient;

export { Prisma };
