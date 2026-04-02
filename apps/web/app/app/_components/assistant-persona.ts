export const TRAIT_SLIDERS = [
  { key: "formality", labelLeftKey: "casual", labelRightKey: "formal" },
  { key: "verbosity", labelLeftKey: "concise", labelRightKey: "detailed" },
  { key: "playfulness", labelLeftKey: "serious", labelRightKey: "playful" },
  { key: "initiative", labelLeftKey: "reactive", labelRightKey: "proactive" },
  { key: "warmth", labelLeftKey: "neutral", labelRightKey: "warm" }
] as const;

export type TraitKey = (typeof TRAIT_SLIDERS)[number]["key"];

export const DEFAULT_TRAITS: Record<TraitKey, number> = {
  formality: 50,
  verbosity: 50,
  playfulness: 50,
  initiative: 50,
  warmth: 50
};

export type AssistantGender = "male" | "female" | "neutral" | null;

export const ASSISTANT_GENDER_OPTIONS: Array<{
  value: Exclude<AssistantGender, null>;
  labelKey: string;
}> = [
  { value: "female", labelKey: "genderFemale" },
  { value: "male", labelKey: "genderMale" },
  { value: "neutral", labelKey: "genderNeutral" }
];

export function normalizeAssistantGender(value: string | null | undefined): AssistantGender {
  if (value === "female" || value === "male" || value === "neutral") {
    return value;
  }

  return null;
}

export function buildAssistantInstructions(params: {
  assistantName: string;
  userName: string;
  traits: Record<TraitKey, number>;
}): string {
  const { assistantName, userName, traits } = params;
  const lines: string[] = [
    `You are ${assistantName || "a personal AI assistant"}.`,
    `Your user's name is ${userName || "your human"}. Address them naturally by name when helpful.`
  ];

  if ((traits.formality ?? 50) < 30) lines.push("Communicate in a casual, conversational tone.");
  else if ((traits.formality ?? 50) > 70) {
    lines.push("Communicate in a formal, polished tone.");
  }

  if ((traits.verbosity ?? 50) < 30) lines.push("Keep responses concise and to the point.");
  else if ((traits.verbosity ?? 50) > 70) {
    lines.push("Provide detailed, thorough explanations when useful.");
  }

  if ((traits.playfulness ?? 50) < 30) lines.push("Maintain a serious, focused demeanor.");
  else if ((traits.playfulness ?? 50) > 70) {
    lines.push("Be playful and light when appropriate.");
  }

  if ((traits.initiative ?? 50) < 30)
    lines.push("Wait for the user to ask before suggesting next steps.");
  else if ((traits.initiative ?? 50) > 70) {
    lines.push("Be proactive and suggest helpful next steps.");
  }

  if ((traits.warmth ?? 50) < 30) lines.push("Stay neutral and composed.");
  else if ((traits.warmth ?? 50) > 70) {
    lines.push("Be warm, encouraging, and empathetic.");
  }

  lines.push("Remember the user's preferences over time and act like a consistent companion.");
  return lines.join("\n");
}

export function traitPreviewLabel(key: TraitKey, value: number): string {
  if (key === "formality") return value < 40 ? "casual" : value > 60 ? "formal" : "balanced";
  if (key === "verbosity") return value < 40 ? "concise" : value > 60 ? "detailed" : "balanced";
  if (key === "playfulness") return value < 40 ? "serious" : value > 60 ? "playful" : "balanced";
  if (key === "initiative") return value < 40 ? "reactive" : value > 60 ? "proactive" : "balanced";
  return value < 40 ? "neutral" : value > 60 ? "warm" : "balanced";
}
