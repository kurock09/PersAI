export const TRAIT_SLIDERS = [
  { key: "formality", labelLeft: "Casual", labelRight: "Formal" },
  { key: "verbosity", labelLeft: "Concise", labelRight: "Detailed" },
  { key: "playfulness", labelLeft: "Serious", labelRight: "Playful" },
  { key: "initiative", labelLeft: "Reactive", labelRight: "Proactive" },
  { key: "warmth", labelLeft: "Neutral", labelRight: "Warm" }
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
  label: string;
}> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "neutral", label: "Neutral" }
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
  if (key === "formality") return value < 40 ? "Casual" : value > 60 ? "Formal" : "Balanced";
  if (key === "verbosity") return value < 40 ? "Concise" : value > 60 ? "Detailed" : "Balanced";
  if (key === "playfulness") return value < 40 ? "Serious" : value > 60 ? "Playful" : "Balanced";
  if (key === "initiative") return value < 40 ? "Reactive" : value > 60 ? "Proactive" : "Balanced";
  return value < 40 ? "Neutral" : value > 60 ? "Warm" : "Balanced";
}
