import assert from "node:assert/strict";
import { renderCrossSessionCarryOverBlock } from "../src/modules/turns/cross-session-carry-over-renderer";
import type {
  InternalCrossSessionCarryOverOpenLoop,
  InternalCrossSessionCarryOverSynopsis
} from "../src/modules/turns/persai-internal-api.client.service";

const NOW = new Date("2026-04-22T12:00:00.000Z");

function buildSynopsis(
  overrides: Partial<InternalCrossSessionCarryOverSynopsis> & {
    summaryText?: string;
  }
): InternalCrossSessionCarryOverSynopsis {
  const { summaryText, ...rest } = overrides;
  const stableFacts =
    summaryText !== undefined ? [summaryText] : ["Decided to ship Atlas next sprint."];
  return {
    runtimeSessionId: "session-x",
    channel: "web",
    synopsisUpdatedAt: NOW.toISOString(),
    summaryPayload: {
      schema: "persai.runtimeSessionCompaction.v2",
      toolCode: "compact_context",
      preservedRecentMessageCount: 4,
      summarizedMessageCount: 6,
      sections: {
        stableFacts,
        userPreferences: [],
        assistantCommitments: [],
        openThreads: [],
        importantReferences: []
      }
    },
    ...rest
  };
}

function buildOpenLoop(
  overrides: Partial<InternalCrossSessionCarryOverOpenLoop> = {}
): InternalCrossSessionCarryOverOpenLoop {
  return {
    id: "loop-x",
    summary: "Need to confirm Barcelona retreat venue.",
    createdAt: NOW.toISOString(),
    ...overrides
  };
}

export async function runCrossSessionCarryOverRendererTest(): Promise<void> {
  // Empty input on both lists → null (caller is responsible for skipping the
  // turn-0 prepend entirely; this is the contract from
  // cross-session-carry-over-renderer.ts).
  assert.equal(
    renderCrossSessionCarryOverBlock({
      recentSynopses: [],
      unresolvedOpenLoops: [],
      now: NOW
    }),
    null
  );

  // Empty open loops AND a synopsis whose payload won't parse → null.
  assert.equal(
    renderCrossSessionCarryOverBlock({
      recentSynopses: [
        buildSynopsis({
          // intentionally invalid schema version → parser returns null → row dropped
          summaryPayload: { schema: "persai.runtimeSessionCompaction.vBOGUS" }
        } as Partial<InternalCrossSessionCarryOverSynopsis>)
      ],
      unresolvedOpenLoops: [],
      now: NOW
    }),
    null
  );

  // Single synopsis (top-1) → "less than an hour ago" wording, NO numbered
  // prefix (because we render a single bullet, not a numbered list).
  const single = renderCrossSessionCarryOverBlock({
    recentSynopses: [
      buildSynopsis({
        synopsisUpdatedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
        channel: "web",
        summaryText: "Atlas review focus = retention."
      })
    ],
    unresolvedOpenLoops: [],
    now: NOW
  });
  assert.notEqual(single, null);
  assert.equal(single?.renderedSynopsisCount, 1);
  assert.equal(single?.renderedOpenLoopCount, 0);
  assert.ok(
    single?.bodyText.includes("- less than an hour ago on Web — "),
    `single-synopsis must use bullet (not numbered); got: ${single?.bodyText}`
  );
  assert.ok(single?.bodyText.includes("Atlas review focus = retention"));

  // Time-aware phrases — multi-synopsis (top-3) gets numbered list, with
  // distinct human ages: "earlier today", "yesterday", "N days ago", and
  // channels rendered as "Web" / "Telegram" / "App".
  const multi = renderCrossSessionCarryOverBlock({
    recentSynopses: [
      buildSynopsis({
        runtimeSessionId: "s-today",
        synopsisUpdatedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
        channel: "web",
        summaryText: "Today: drafted Atlas review outline."
      }),
      buildSynopsis({
        runtimeSessionId: "s-yesterday",
        synopsisUpdatedAt: new Date(NOW.getTime() - 24 * 3_600_000).toISOString(),
        channel: "telegram",
        summaryText: "Yesterday: locked retreat dates."
      }),
      buildSynopsis({
        runtimeSessionId: "s-old",
        synopsisUpdatedAt: new Date(NOW.getTime() - 4 * 24 * 3_600_000).toISOString(),
        channel: "app",
        summaryText: "Earlier: agreed Helio is post-Atlas."
      })
    ],
    unresolvedOpenLoops: [],
    now: NOW
  });
  assert.notEqual(multi, null);
  assert.equal(multi?.renderedSynopsisCount, 3);
  const multiBody = multi?.bodyText ?? "";
  assert.ok(multiBody.includes("1. earlier today on Web — "), multiBody);
  assert.ok(multiBody.includes("2. yesterday on Telegram — "), multiBody);
  assert.ok(multiBody.match(/3\. \d+ days ago on App — /), multiBody);

  // Open-loop top-N cap = 10. Even with 15 incoming items, only 10 render.
  // Order is preserved in input order (the API is the one that imposes
  // recency ordering; the renderer trusts it).
  // ADR-074 Slice M3.1 — each rendered open-loop line must include a
  // `[ref: <id>]` prefix so the model can call
  // `memory_write({ action: "close", ref })` deterministically.
  const manyLoops = Array.from({ length: 15 }, (_, index) =>
    buildOpenLoop({
      id: `loop-${String(index + 1)}`,
      summary: `Open loop number ${String(index + 1)}`
    })
  );
  const cappedLoops = renderCrossSessionCarryOverBlock({
    recentSynopses: [],
    unresolvedOpenLoops: manyLoops,
    now: NOW
  });
  assert.notEqual(cappedLoops, null);
  assert.equal(cappedLoops?.renderedOpenLoopCount, 10);
  const loopLines = (cappedLoops?.bodyText ?? "")
    .split("\n")
    .filter((line) => /^- \[ref: [^\]]+\] Open loop /.test(line));
  assert.equal(loopLines.length, 10);
  assert.equal(loopLines[0], "- [ref: loop-1] Open loop number 1");
  assert.equal(loopLines[9], "- [ref: loop-10] Open loop number 10");
  assert.ok(!cappedLoops?.bodyText.includes("Open loop number 11"));
  assert.ok(
    !cappedLoops?.bodyText.includes("[ref: loop-11]"),
    "loops past the top-N cap must NOT leak refs into the rendered block"
  );

  // Whitespace-only / empty open-loop summaries are filtered out (the
  // renderer normalizes via normalizeOpenLoopSummary). The bullet count must
  // equal the number of NON-empty summaries. Refs (M3.1) are included for
  // every kept summary.
  const mixed = renderCrossSessionCarryOverBlock({
    recentSynopses: [],
    unresolvedOpenLoops: [
      buildOpenLoop({ id: "ok", summary: "   Confirm Barcelona venue.   " }),
      buildOpenLoop({ id: "blank", summary: "    " }),
      buildOpenLoop({ id: "ok2", summary: "Send the retention deck to Maya." })
    ],
    now: NOW
  });
  assert.equal(mixed?.renderedOpenLoopCount, 2);
  assert.ok(mixed?.bodyText.includes("- [ref: ok] Confirm Barcelona venue."));
  assert.ok(mixed?.bodyText.includes("- [ref: ok2] Send the retention deck to Maya."));
  assert.ok(
    !mixed?.bodyText.includes("[ref: blank]"),
    "filtered-out (whitespace-only) loops must NOT have their ref leaked into the rendered block"
  );

  // Footer is always present once we have at least one rendered row, and
  // contains the canonical anti-recap rules (DO/DON'T sections from
  // ADR-074 Slice M3 acceptance: "magic, not status report").
  assert.ok(mixed?.bodyText.includes("# How to use this continuity"));
  assert.ok(mixed?.bodyText.includes("DO:"));
  assert.ok(mixed?.bodyText.includes("DON'T:"));
  assert.ok(
    mixed?.bodyText.includes("- Read the synopsis back to the user. They lived it."),
    "footer must include the no-recap-readback rule"
  );
  // ADR-074 Slice M3.1 — the footer must teach the model how to use the new
  // `[ref: …]` markers via `memory_write({ action: "close", ref })`.
  assert.ok(
    mixed?.bodyText.includes('memory_write({ action: "close", ref })'),
    "footer must include the close-by-ref usage rule introduced by M3.1"
  );
  assert.ok(mixed?.bodyText.includes("[ref:"), "footer must reference the [ref: …] marker shape");

  // Section ordering: synopses come BEFORE open loops, separated by a
  // blank line, then the rules footer follows another blank line.
  const both = renderCrossSessionCarryOverBlock({
    recentSynopses: [
      buildSynopsis({
        synopsisUpdatedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
        summaryText: "Drafted Atlas review outline."
      })
    ],
    unresolvedOpenLoops: [buildOpenLoop({ summary: "Confirm Barcelona retreat venue." })],
    now: NOW
  });
  const bothBody = both?.bodyText ?? "";
  const synopsisIndex = bothBody.indexOf("Recent conversations");
  const openLoopsIndex = bothBody.indexOf("Things you've kept in mind for this person:");
  const footerIndex = bothBody.indexOf("# How to use this continuity");
  assert.ok(synopsisIndex >= 0 && openLoopsIndex > synopsisIndex && footerIndex > openLoopsIndex);
}
