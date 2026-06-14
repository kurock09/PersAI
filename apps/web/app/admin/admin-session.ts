export type ClerkGetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

/** Fresh Clerk JWT for admin API calls (avoids stale cached tokens on long-lived tabs). */
export async function getAdminSessionToken(getToken: ClerkGetToken): Promise<string | null> {
  return (await getToken({ skipCache: true })) ?? (await getToken());
}
