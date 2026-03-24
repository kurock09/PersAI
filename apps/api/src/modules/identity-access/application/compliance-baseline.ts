export const MVP_TERMS_OF_SERVICE_VERSION = "persai_tos_mvp_v1";
export const MVP_PRIVACY_POLICY_VERSION = "persai_privacy_mvp_v1";

export type ComplianceRetentionDeleteBaseline = {
  retentionModel: "user_controlled_no_silent_ttl";
  chatRetention: "retained_until_archive_or_hard_delete";
  memoryRegistryRetention: "retained_until_forget_or_do_not_remember";
  taskRegistryRetention: "retained_until_user_control_change";
  deleteModel: "explicit_action_only";
  auditModel: "append_only_immutable";
};

export function buildComplianceRetentionDeleteBaseline(): ComplianceRetentionDeleteBaseline {
  return {
    retentionModel: "user_controlled_no_silent_ttl",
    chatRetention: "retained_until_archive_or_hard_delete",
    memoryRegistryRetention: "retained_until_forget_or_do_not_remember",
    taskRegistryRetention: "retained_until_user_control_change",
    deleteModel: "explicit_action_only",
    auditModel: "append_only_immutable"
  };
}
