export interface ResolvedAuthUser {
  clerkUserId: string;
  email: string;
  displayName: string | null;
}

export interface ResolvedAppUser {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
}
