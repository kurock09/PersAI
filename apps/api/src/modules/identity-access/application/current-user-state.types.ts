export interface CurrentWorkspaceSummary {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  status: "active" | "inactive";
  role: "owner" | "member";
}

export interface CurrentUserState {
  appUser: {
    id: string;
    clerkUserId: string;
    email: string;
    displayName: string | null;
  };
  onboarding: {
    isComplete: boolean;
    status: "completed" | "pending";
  };
  workspace: CurrentWorkspaceSummary | null;
}
