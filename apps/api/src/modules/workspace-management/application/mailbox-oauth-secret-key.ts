/**
 * Workspace-scoped key for the encrypted OAuth token envelope. Kept separate
 * from the mailbox service so token lifecycle and connection flows do not form
 * a circular Nest dependency.
 */
export function mailboxOAuthSecretProviderKey(workspaceId: string): string {
  return `mailbox_oauth:${workspaceId}`;
}
