export type GammaThemeCatalogEntry = {
  id: string;
  name: string;
  type: "standard" | "custom";
  colorKeywords: string[];
  toneKeywords: string[];
};

export type GammaThemePickerResult = {
  themeId: string | null;
  reason: string | null;
};
