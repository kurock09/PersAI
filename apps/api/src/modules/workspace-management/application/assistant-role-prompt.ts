/**
 * Shared Role mission XML renderer used by production materialization and Admin preview.
 * Keep escaping and tag shape byte-identical across both owners.
 */
export function renderAssistantRoleMissionBlock(mission: string | null | undefined): string {
  const normalizedMission = normalizeOptionalText(mission);
  if (normalizedMission === null) {
    return "";
  }
  return `<assistant_role>\n<mission>${escapeXmlText(normalizedMission)}</mission>\n</assistant_role>`;
}

export function escapeAssistantRoleXmlText(value: string): string {
  return escapeXmlText(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
