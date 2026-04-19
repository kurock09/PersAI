function containsCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

function buildUndeliveredAttachmentCorrection(text: string, locale?: string | null): string {
  if (locale?.toLowerCase().startsWith("ru") || containsCyrillic(text)) {
    return "Поправка: файл не был реально доставлен в этот чат в рамках этого ответа.";
  }
  return "Correction: no file was actually delivered in this reply.";
}

export function applyFinalDeliveryHonestyCorrection(input: {
  assistantText: string;
  attemptedArtifactCount: number;
  deliveredAttachmentCount: number;
  locale?: string | null;
}): string {
  const normalizedText = input.assistantText.trim();
  if (normalizedText.length === 0) {
    return normalizedText;
  }
  if (input.attemptedArtifactCount <= 0 || input.deliveredAttachmentCount > 0) {
    return normalizedText;
  }
  const correction = buildUndeliveredAttachmentCorrection(normalizedText, input.locale);
  return normalizedText.includes(correction)
    ? normalizedText
    : `${normalizedText}\n\n${correction}`;
}
