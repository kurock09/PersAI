export interface CurrentWorkspaceSummary {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  status: "active" | "inactive";
  role: "owner" | "member";
}

export interface CurrentComplianceState {
  termsOfService: {
    requiredVersion: string;
    acceptedVersion: string | null;
    acceptedAt: string | null;
    accepted: boolean;
  };
  privacyPolicy: {
    requiredVersion: string;
    acceptedVersion: string | null;
    acceptedAt: string | null;
    accepted: boolean;
  };
  retentionAndDeleteBaseline: {
    retentionModel: "user_controlled_no_silent_ttl";
    chatRetention: "retained_until_archive_or_hard_delete";
    memoryRegistryRetention: "retained_until_forget_or_do_not_remember";
    taskRegistryRetention: "retained_until_user_control_change";
    deleteModel: "explicit_action_only";
    auditModel: "append_only_immutable";
  };
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
  compliance: CurrentComplianceState;
  workspace: CurrentWorkspaceSummary | null;
}
