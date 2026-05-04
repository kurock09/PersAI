import assert from "node:assert/strict";
import { SkillRetrievalPolicyService } from "../src/modules/workspace-management/application/skill-retrieval-policy.service";

async function run(): Promise<void> {
  const service = new SkillRetrievalPolicyService();
  const stableCandidateHash = service.buildCandidateSetHash([
    "skill:skill-diet:skill_document:doc-1:1:0",
    "skill:skill-diet:skill_document:doc-1:1:1"
  ]);
  const state = {
    activeSkillId: "skill-diet",
    lastUserMessageId: "message-1",
    lastUserQueryFingerprint: "diet meal calories",
    lastTopReferenceIds: [
      "skill:skill-diet:skill_document:doc-1:1:0",
      "skill:skill-diet:skill_document:doc-1:1:1"
    ],
    lastTopReferenceScores: [0.92, 0.84],
    lastRetrievedAtMessageIndex: 2,
    lastMode: "refresh_search_only" as const,
    lastHelperApplied: true,
    lastHelperChangedOrder: false,
    reuseStreak: 0,
    lastCandidateSetHash: stableCandidateHash
  };

  const reuseDecision = service.decideBeforeSearch({
    activeSkillId: "skill-diet",
    currentUserMessageId: "message-2",
    queryFingerprint: "diet meal calories",
    state
  });
  assert.equal(reuseDecision?.mode, "reuse_cached_refs");

  const stableDecision = service.decideAfterSearch({
    activeSkillId: "skill-diet",
    queryFingerprint: "diet meal calories plan",
    state,
    candidates: [
      { referenceId: "skill:skill-diet:skill_document:doc-1:1:0", score: 0.58 },
      { referenceId: "skill:skill-diet:skill_document:doc-1:1:1", score: 0.52 }
    ]
  });
  assert.equal(
    stableDecision.mode,
    "refresh_search_only",
    "Stable candidate sets should skip helper rerank when the last helper pass did not improve order."
  );

  const driftDecision = service.decideAfterSearch({
    activeSkillId: "skill-diet",
    queryFingerprint: "diet meal calories plan",
    state,
    candidates: [
      { referenceId: "skill:skill-diet:skill_document:doc-2:1:0", score: 0.58 },
      { referenceId: "skill:skill-diet:skill_document:doc-2:1:1", score: 0.52 }
    ]
  });
  assert.equal(
    driftDecision.mode,
    "refresh_with_helper",
    "Candidate-set drift should force helper reranking instead of reusing the last ordering signal."
  );
}

void run();
