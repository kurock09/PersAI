import {
  parseStoredReusableCompactionState,
  type ParsedReusableCompactionState
} from "./shared-compaction-state";
import type {
  InternalCrossSessionCarryOverOpenLoop,
  InternalCrossSessionCarryOverSynopsis
} from "./persai-internal-api.client.service";
import { humanizeAge } from "./relative-time-formatter";

// ADR-074 Slice T1 — re-export the shared bilingual relative-time formatter
// so M3 callers can keep importing `humanizeAge` from this module while T1's
// new presence renderer consumes the same helper directly. M3 intentionally
// does NOT pass a locale, so its English-only behaviour is preserved
// byte-for-byte.
export { humanizeAge } from "./relative-time-formatter";

// ADR-074 Slice M3 — render the cross-session continuity carry-over block
// that prepends the very first turn of a brand-new thread. The block has
// two sections (synopses + open loops) and ends with a stable usage-rules
// footer copied from ADR-074 ("magic vs creepy" anti-recap rules). The
// rules are rendered IN-LINE here (rather than living in the system
// prompt) so they live as part of the same cached stable block — when
// the block is absent on turn 2+, the rules are absent too, which is
// exactly what we want (no per-turn token tax for an artifact that only
// applies to the cold-open turn).

const CARRY_OVER_SYNOPSIS_CHAR_BUDGET = 1_200;
const MAX_OPEN_LOOPS_RENDERED = 10;

export interface CrossSessionCarryOverRenderInput {
  recentSynopses: InternalCrossSessionCarryOverSynopsis[];
  unresolvedOpenLoops: InternalCrossSessionCarryOverOpenLoop[];
  now: Date;
}

export interface CrossSessionCarryOverRenderOutcome {
  bodyText: string;
  renderedSynopsisCount: number;
  renderedOpenLoopCount: number;
}

/**
 * Returns `null` when both lists are effectively empty after parsing /
 * filtering — the caller MUST treat that as "no M3 block this turn" and
 * skip the prepend entirely (per ADR-074 Slice M3 Implementation step 5).
 */
export function renderCrossSessionCarryOverBlock(
  input: CrossSessionCarryOverRenderInput
): CrossSessionCarryOverRenderOutcome | null {
  const renderedSynopses = input.recentSynopses
    .map((row) => renderSynopsisRow(row, input.now))
    .filter((row): row is RenderedSynopsis => row !== null);
  const renderedOpenLoops = input.unresolvedOpenLoops
    .slice(0, MAX_OPEN_LOOPS_RENDERED)
    .map((row) => {
      const text = normalizeOpenLoopSummary(row.summary);
      return text === null ? null : { ref: row.id, text };
    })
    .filter((value): value is { ref: string; text: string } => value !== null);

  if (renderedSynopses.length === 0 && renderedOpenLoops.length === 0) {
    return null;
  }

  const lines: string[] = ["# Continuity from earlier conversations"];

  if (renderedSynopses.length > 0) {
    lines.push("Recent conversations (most recent first):");
    if (renderedSynopses.length === 1) {
      const synopsis = renderedSynopses[0]!;
      lines.push(`- ${synopsis.ageHuman} on ${synopsis.channel} — ${synopsis.text}`);
    } else {
      renderedSynopses.forEach((synopsis, index) => {
        lines.push(
          `${String(index + 1)}. ${synopsis.ageHuman} on ${synopsis.channel} — ${synopsis.text}`
        );
      });
    }
  }

  if (renderedOpenLoops.length > 0) {
    if (renderedSynopses.length > 0) {
      lines.push("");
    }
    lines.push("Things you've kept in mind for this person:");
    for (const openLoop of renderedOpenLoops) {
      // ADR-074 Slice M3.1 — surface an opaque ref next to each open loop so
      // the model can deterministically close it via
      // `memory_write({ action: "close", ref })` once it confirms with the
      // user that the loop is resolved. The ref is just the registry id;
      // the runtime forwards it verbatim to the close-by-ref endpoint.
      lines.push(`- [ref: ${openLoop.ref}] ${openLoop.text}`);
    }
  }

  lines.push("");
  lines.push("# How to use this continuity (humanity over recap)");
  lines.push(
    "You are one continuous presence in this person's life across Web, App, and Telegram. The fact that the last chat was on a different surface than this one is normal — do not flag it."
  );
  lines.push("");
  lines.push("DO:");
  lines.push(
    "- Lead with current presence — match the user's energy and the message they just sent."
  );
  lines.push(
    "- If the current topic naturally connects to a previous conversation or open loop, weave it in lightly (one short, human reference)."
  );
  lines.push(
    "- Surface an open loop only when its natural follow-up moment has arrived — the topic is contextually live, or the user themselves opens that thread."
  );
  lines.push(
    "- Use the previous-conversation channel as background context only; you know it, but you do not announce it."
  );
  lines.push(
    '- When the user confirms an open loop above is resolved (decision made, action taken, no longer relevant), close it with `memory_write({ action: "close", ref })` using the `[ref: …]` value shown next to the loop. Do not invent refs and do not echo the ref text in your reply.'
  );
  lines.push("");
  lines.push("DON'T:");
  lines.push(
    '- Open with a recap or status report ("last time we discussed…", "помню, мы вчера обсуждали…", "хочу напомнить про…").'
  );
  lines.push("- Read the synopsis back to the user. They lived it.");
  lines.push(
    '- Reference the previous channel by name ("ты на Web писала про…") — it sounds clinical and surveillance-y.'
  );
  lines.push(
    "- List open loops at the start of a conversation. Surface them when relevant, not as a status report."
  );
  lines.push(
    "- If the user opens cold with a question unrelated to anything above, ignore the carry-over entirely and just answer."
  );

  return {
    bodyText: lines.join("\n"),
    renderedSynopsisCount: renderedSynopses.length,
    renderedOpenLoopCount: renderedOpenLoops.length
  };
}

interface RenderedSynopsis {
  ageHuman: string;
  channel: string;
  text: string;
}

function renderSynopsisRow(
  row: InternalCrossSessionCarryOverSynopsis,
  now: Date
): RenderedSynopsis | null {
  const synopsisUpdatedAt = parseDate(row.synopsisUpdatedAt);
  if (synopsisUpdatedAt === null) {
    return null;
  }
  const text = renderSynopsisText(row.summaryPayload);
  if (text === null) {
    return null;
  }
  return {
    ageHuman: humanizeAge(synopsisUpdatedAt, now),
    channel: humanizeChannel(row.channel),
    text
  };
}

function renderSynopsisText(summaryPayload: unknown): string | null {
  // The API hands us the raw `RuntimeSessionCompaction.summaryPayload` JSON
  // exactly as the M2 reusable-compaction state writer stored it. Parse it
  // through the M2 helper to get a deterministic, budgeted summary string.
  let parsed: ParsedReusableCompactionState | null;
  try {
    parsed = parseStoredReusableCompactionState(summaryPayload, CARRY_OVER_SYNOPSIS_CHAR_BUDGET);
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    return null;
  }
  const trimmed = parsed.summaryText.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOpenLoopSummary(summary: string): string | null {
  const trimmed = summary.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function humanizeChannel(channel: string): string {
  switch (channel) {
    case "web":
      return "Web";
    case "telegram":
      return "Telegram";
    case "app":
      return "App";
    default:
      return channel;
  }
}
