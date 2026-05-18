type ClerkErrorLike = {
  code?: string;
  message?: string;
  longMessage?: string;
};

function readCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as ClerkErrorLike).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

/**
 * Map Clerk error codes to localized user-facing copy.
 * Raw Clerk `longMessage` / `message` are kept for logs only.
 */
export function mapClerkError(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string
): string {
  const code = readCode(error);
  if (code === null) {
    return t(fallbackKey);
  }

  const key = `clerkErrors.${code}`;
  try {
    return t(key);
  } catch {
    return t(fallbackKey);
  }
}
