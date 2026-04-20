import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PERSONA_ARCHETYPE_DEFAULTS,
  UNIVERSAL_FORBIDDEN_OPENINGS,
  type PersonaArchetypeDefinition
} from "../prisma/persona-archetype-data";
import {
  modulateVoiceDna,
  resolveVoiceDnaLocale
} from "../src/modules/workspace-management/application/voice-dna-modulator";
import type {
  PersonaArchetype,
  PersonaArchetypeLocale
} from "../src/modules/workspace-management/domain/persona-archetype.entity";

function toRuntimeArchetype(definition: PersonaArchetypeDefinition): PersonaArchetype {
  return {
    ...definition,
    updatedAt: new Date("2026-04-21T00:00:00.000Z")
  } as unknown as PersonaArchetype;
}

describe("resolveVoiceDnaLocale", () => {
  test("returns ru when locale starts with ru", () => {
    assert.equal(resolveVoiceDnaLocale("ru-RU"), "ru");
    assert.equal(resolveVoiceDnaLocale("ru"), "ru");
    assert.equal(resolveVoiceDnaLocale("RU-ru"), "ru");
  });

  test("falls back to en for unknown / null locales", () => {
    assert.equal(resolveVoiceDnaLocale(null), "en");
    assert.equal(resolveVoiceDnaLocale(undefined), "en");
    assert.equal(resolveVoiceDnaLocale(""), "en");
    assert.equal(resolveVoiceDnaLocale("en-US"), "en");
    assert.equal(resolveVoiceDnaLocale("fr-FR"), "en");
  });
});

describe("modulateVoiceDna — neutral 50/50 traits preserve archetype voice", () => {
  const NEUTRAL = {
    formality: 50,
    verbosity: 50,
    playfulness: 50,
    initiative: 50,
    warmth: 50
  } as const;

  for (const definition of PERSONA_ARCHETYPE_DEFAULTS) {
    for (const locale of ["en", "ru"] as const) {
      test(`${definition.key}/${locale} — sliders at 50 do not nudge archetype voice`, () => {
        const resolved = modulateVoiceDna({
          archetype: toRuntimeArchetype(definition),
          traits: NEUTRAL,
          locale
        });

        assert.equal(resolved.archetypeKey, definition.key);
        assert.equal(resolved.archetypeLabel, definition.label[locale]);
        assert.equal(resolved.voice.sentenceLength, definition.voice.sentenceLength);
        assert.equal(resolved.voice.pace, definition.voice.pace);
        assert.equal(resolved.voice.irony, definition.voice.irony);
        assert.deepEqual(resolved.openingsAllowed, definition.openingsAllowed[locale]);
        assert.equal(resolved.silenceRule, definition.silenceRule[locale]);
        assert.equal(resolved.examples.length, definition.examples.length);
      });
    }
  }
});

describe("modulateVoiceDna — archetype default traits flow through when no override", () => {
  for (const definition of PERSONA_ARCHETYPE_DEFAULTS) {
    test(`${definition.key} — null override surfaces archetype defaultTraits`, () => {
      const resolved = modulateVoiceDna({
        archetype: toRuntimeArchetype(definition),
        traits: null,
        locale: "en"
      });
      assert.deepEqual(resolved.traits, definition.defaultTraits);
      assert.equal(resolved.archetypeKey, definition.key);
      assert.equal(resolved.examples.length, definition.examples.length);
    });
  }
});

describe("modulateVoiceDna — slider nudges", () => {
  const archetype = toRuntimeArchetype(PERSONA_ARCHETYPE_DEFAULTS[0]!);

  test("verbosity > 70 lengthens sentences (clamped at long)", () => {
    const resolved = modulateVoiceDna({
      archetype,
      traits: { verbosity: 95 },
      locale: "en"
    });
    const order = ["short", "medium", "long"] as const;
    const baseIdx = order.indexOf(archetype.voice.sentenceLength);
    const expected = order[Math.min(order.length - 1, baseIdx + 1)];
    assert.equal(resolved.voice.sentenceLength, expected);
  });

  test("verbosity < 30 shortens sentences (clamped at short)", () => {
    const longArchetype = toRuntimeArchetype(
      PERSONA_ARCHETYPE_DEFAULTS.find((entry) => entry.voice.sentenceLength === "medium")!
    );
    const resolved = modulateVoiceDna({
      archetype: longArchetype,
      traits: { verbosity: 5 },
      locale: "en"
    });
    assert.equal(resolved.voice.sentenceLength, "short");
  });

  test("playfulness > 70 boosts irony but caps at 90", () => {
    const playfulArchetype = toRuntimeArchetype(
      PERSONA_ARCHETYPE_DEFAULTS.find((entry) => entry.key === "playful-sharp")!
    );
    const resolved = modulateVoiceDna({
      archetype: playfulArchetype,
      traits: { playfulness: 100 },
      locale: "en"
    });
    assert.ok(resolved.voice.irony <= 90, `irony ${resolved.voice.irony} should be ≤ 90`);
    assert.ok(
      resolved.voice.irony >= playfulArchetype.voice.irony,
      "playfulness=100 should not lower irony below baseline"
    );
  });

  test("playfulness < 30 halves irony floor", () => {
    const playfulArchetype = toRuntimeArchetype(
      PERSONA_ARCHETYPE_DEFAULTS.find((entry) => entry.key === "playful-sharp")!
    );
    const resolved = modulateVoiceDna({
      archetype: playfulArchetype,
      traits: { playfulness: 5 },
      locale: "en"
    });
    assert.ok(
      resolved.voice.irony < playfulArchetype.voice.irony,
      "playfulness=5 must strictly lower irony"
    );
  });

  test("initiative > 70 nudges pace one step quicker", () => {
    const slowArchetype = toRuntimeArchetype(
      PERSONA_ARCHETYPE_DEFAULTS.find((entry) => entry.voice.pace === "slow")!
    );
    const resolved = modulateVoiceDna({
      archetype: slowArchetype,
      traits: { initiative: 95 },
      locale: "en"
    });
    assert.equal(resolved.voice.pace, "normal");
  });

  test("clamps trait values to [0, 100]", () => {
    const resolved = modulateVoiceDna({
      archetype,
      traits: { verbosity: 9999, warmth: -50 },
      locale: "en"
    });
    assert.ok(resolved.traits.verbosity >= 0 && resolved.traits.verbosity <= 100);
    assert.ok(resolved.traits.warmth >= 0 && resolved.traits.warmth <= 100);
  });
});

describe("modulateVoiceDna — forbidden openings include AI tells", () => {
  for (const definition of PERSONA_ARCHETYPE_DEFAULTS) {
    for (const locale of ["en", "ru"] as PersonaArchetypeLocale[]) {
      test(`${definition.key}/${locale} contains every universal AI tell`, () => {
        const resolved = modulateVoiceDna({
          archetype: toRuntimeArchetype(definition),
          traits: null,
          locale
        });
        for (const phrase of UNIVERSAL_FORBIDDEN_OPENINGS[locale]) {
          assert.ok(
            resolved.openingsForbidden.includes(phrase),
            `${definition.key}/${locale} forbidden list must include "${phrase}"`
          );
        }
      });

      test(`${definition.key}/${locale} keeps archetype-specific forbidden phrases`, () => {
        const resolved = modulateVoiceDna({
          archetype: toRuntimeArchetype(definition),
          traits: null,
          locale
        });
        for (const phrase of definition.openingsForbidden[locale]) {
          assert.ok(
            resolved.openingsForbidden.includes(phrase),
            `${definition.key}/${locale} forbidden list must keep "${phrase}"`
          );
        }
      });

      test(`${definition.key}/${locale} dedupes forbidden openings`, () => {
        const resolved = modulateVoiceDna({
          archetype: toRuntimeArchetype(definition),
          traits: null,
          locale
        });
        const unique = new Set(resolved.openingsForbidden);
        assert.equal(
          unique.size,
          resolved.openingsForbidden.length,
          "forbidden openings must not contain duplicates"
        );
      });
    }
  }
});

describe("modulateVoiceDna — locale fallback", () => {
  test("missing ru localization falls back to en", () => {
    const archetype = toRuntimeArchetype(PERSONA_ARCHETYPE_DEFAULTS[0]!);
    const partialArchetype: PersonaArchetype = {
      ...archetype,
      label: { en: "English Only", ru: undefined as unknown as string },
      description: { en: "English only.", ru: undefined as unknown as string }
    };
    const resolved = modulateVoiceDna({
      archetype: partialArchetype,
      traits: null,
      locale: "ru"
    });
    assert.equal(resolved.archetypeLabel, "English Only");
    assert.equal(resolved.archetypeDescription, "English only.");
  });
});
