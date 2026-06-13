export type SafetyHeuristicRuleSeed = {
  signalId: string;
  pack:
    | "violence_extremism_explicit"
    | "hack_abuse_request"
    | "unsolicited_adult_spam"
    | "structural_abuse_signal";
  locale: "any" | "ru" | "en";
  patternType: "literal" | "regex";
  pattern: string;
  weight: number;
};

export const SAFETY_HEURISTIC_RULE_SEEDS: SafetyHeuristicRuleSeed[] = [
  {
    signalId: "violence.mass_attack_instruction_ru",
    pack: "violence_extremism_explicit",
    locale: "ru",
    patternType: "literal",
    pattern: "как сделать бомбу",
    weight: 8
  },
  {
    signalId: "violence.mass_attack_instruction_en",
    pack: "violence_extremism_explicit",
    locale: "en",
    patternType: "literal",
    pattern: "how to make a bomb",
    weight: 8
  },
  {
    signalId: "violence.terror_attack_plan_ru",
    pack: "violence_extremism_explicit",
    locale: "ru",
    patternType: "regex",
    pattern: "план\\s+(террорист|теракт)",
    weight: 7
  },
  {
    signalId: "violence.terror_attack_plan_en",
    pack: "violence_extremism_explicit",
    locale: "en",
    patternType: "regex",
    pattern: "terror(ist)?\\s+attack\\s+plan",
    weight: 7
  },
  {
    signalId: "hack.credential_theft_ru",
    pack: "hack_abuse_request",
    locale: "ru",
    patternType: "regex",
    pattern: "взлом(ай|ать)?\\s+(парол|аккаунт|почт)",
    weight: 5
  },
  {
    signalId: "hack.credential_theft_en",
    pack: "hack_abuse_request",
    locale: "en",
    patternType: "regex",
    pattern: "steal\\s+(passwords|credentials|login)",
    weight: 5
  },
  {
    signalId: "hack.malware_distribution_ru",
    pack: "hack_abuse_request",
    locale: "ru",
    patternType: "regex",
    pattern: "распростран(и|ять)\\s+(вирус|малвар|троян)",
    weight: 6
  },
  {
    signalId: "hack.malware_distribution_en",
    pack: "hack_abuse_request",
    locale: "en",
    patternType: "regex",
    pattern: "distribute\\s+(malware|ransomware|keylogger)",
    weight: 6
  },
  {
    signalId: "spam.mass_porn_distribution_ru",
    pack: "unsolicited_adult_spam",
    locale: "ru",
    patternType: "regex",
    pattern: "разошл(и|ите)\\s+порно",
    weight: 6
  },
  {
    signalId: "spam.mass_porn_distribution_en",
    pack: "unsolicited_adult_spam",
    locale: "en",
    patternType: "regex",
    pattern: "send\\s+porn\\s+(links|spam)\\s+to",
    weight: 6
  },
  {
    signalId: "spam.adult_url_flood",
    pack: "unsolicited_adult_spam",
    locale: "any",
    patternType: "regex",
    pattern: "(https?:\\/\\/\\S+\\s+){3,}(porn|xxx|onlyfans)",
    weight: 5
  },
  {
    signalId: "structural.link_only_message",
    pack: "structural_abuse_signal",
    locale: "any",
    patternType: "regex",
    pattern: "^\\s*https?:\\/\\/\\S+\\s*$",
    weight: 3
  },
  {
    signalId: "structural.base64_noise",
    pack: "structural_abuse_signal",
    locale: "any",
    patternType: "regex",
    pattern: "^[A-Za-z0-9+/=\\s]{200,}$",
    weight: 4
  }
];
