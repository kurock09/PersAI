export type AssistantAvatarPreset = {
  id: string;
  label: string;
  imagePath: string;
  defaultName: string;
};

export const ASSISTANT_AVATAR_PRESETS: AssistantAvatarPreset[] = [
  {
    id: "persai",
    label: "PersAI",
    imagePath: "/avatar-presets/persai.png",
    defaultName: "PERSAI"
  },
  {
    id: "luma",
    label: "Luma",
    imagePath: "/avatar-presets/luma.png",
    defaultName: "Luma"
  },
  {
    id: "theo",
    label: "Theo",
    imagePath: "/avatar-presets/theo.png",
    defaultName: "Theo"
  },
  {
    id: "lyra",
    label: "Lyra",
    imagePath: "/avatar-presets/lyra.png",
    defaultName: "Lyra"
  },
  {
    id: "nico",
    label: "Nico",
    imagePath: "/avatar-presets/nico.png",
    defaultName: "Nico"
  },
  {
    id: "vera",
    label: "Vera",
    imagePath: "/avatar-presets/vera.png",
    defaultName: "Vera"
  },
  {
    id: "adrian",
    label: "Adrian",
    imagePath: "/avatar-presets/adrian.png",
    defaultName: "Adrian"
  }
];

export function findAssistantAvatarPresetByUrl(
  avatarUrl: string | null | undefined
): AssistantAvatarPreset | null {
  if (!avatarUrl) {
    return null;
  }
  return ASSISTANT_AVATAR_PRESETS.find((preset) => preset.imagePath === avatarUrl) ?? null;
}
