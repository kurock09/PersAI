import { Injectable } from "@nestjs/common";
import type {
  SkillRetrievalDecisionMode,
  SkillRetrievalState
} from "./skill-retrieval-state.service";

type RetrievalPolicyCandidate = {
  referenceId: string;
  score: number;
};

export type SkillRetrievalPolicyDecision = {
  mode: SkillRetrievalDecisionMode;
  querySimilarityToLastTurn: number;
  cachedReferenceCoverage: number;
  candidateAmbiguity: number | null;
  candidateCount: number;
  topScoreMargin: number | null;
};

const MAX_REUSE_STREAK = 2;
const REUSE_SIMILARITY_THRESHOLD = 0.82;
const SEARCH_ONLY_SIMILARITY_THRESHOLD = 0.55;
const CLEAR_MARGIN_THRESHOLD = 0.12;

@Injectable()
export class SkillRetrievalPolicyService {
  decideBeforeSearch(input: {
    activeSkillId: string | null;
    currentUserMessageId: string | null;
    queryFingerprint: string;
    state: SkillRetrievalState | null;
  }): SkillRetrievalPolicyDecision | null {
    if (
      input.activeSkillId === null ||
      input.currentUserMessageId === null ||
      input.state === null ||
      input.state.activeSkillId !== input.activeSkillId ||
      input.state.lastUserMessageId === input.currentUserMessageId ||
      input.state.lastTopReferenceIds.length === 0
    ) {
      return null;
    }
    const similarity = this.computeQuerySimilarity(
      input.queryFingerprint,
      input.state.lastUserQueryFingerprint
    );
    if (similarity < REUSE_SIMILARITY_THRESHOLD || input.state.reuseStreak >= MAX_REUSE_STREAK) {
      return null;
    }
    return {
      mode: "reuse_cached_refs",
      querySimilarityToLastTurn: similarity,
      cachedReferenceCoverage: 1,
      candidateAmbiguity: null,
      candidateCount: input.state.lastTopReferenceIds.length,
      topScoreMargin: null
    };
  }

  decideAfterSearch(input: {
    activeSkillId: string | null;
    queryFingerprint: string;
    state: SkillRetrievalState | null;
    candidates: RetrievalPolicyCandidate[];
  }): SkillRetrievalPolicyDecision {
    const similarity =
      input.activeSkillId !== null &&
      input.state !== null &&
      input.state.activeSkillId === input.activeSkillId
        ? this.computeQuerySimilarity(input.queryFingerprint, input.state.lastUserQueryFingerprint)
        : 0;
    const cachedReferenceCoverage = this.computeCachedReferenceCoverage(
      input.state,
      input.candidates.map((candidate) => candidate.referenceId)
    );
    const candidateSetHash = this.buildCandidateSetHash(
      input.candidates.map((candidate) => candidate.referenceId)
    );
    const candidateSetStable =
      candidateSetHash !== null &&
      input.state?.lastCandidateSetHash !== null &&
      input.state?.lastCandidateSetHash === candidateSetHash;
    const candidateCount = input.candidates.length;
    const topScoreMargin =
      candidateCount >= 2
        ? Math.max(0, input.candidates[0]!.score - input.candidates[1]!.score)
        : null;
    const candidateAmbiguity =
      topScoreMargin === null ? 0 : Math.max(0, 1 - Math.min(1, topScoreMargin));
    const helperWouldLikelyChangeLittle =
      input.state?.lastHelperApplied === true &&
      input.state.lastHelperChangedOrder === false &&
      candidateSetStable;
    if (
      candidateCount <= 1 ||
      (topScoreMargin !== null && topScoreMargin >= CLEAR_MARGIN_THRESHOLD) ||
      (similarity >= SEARCH_ONLY_SIMILARITY_THRESHOLD && cachedReferenceCoverage >= 0.5) ||
      (helperWouldLikelyChangeLittle &&
        similarity >= SEARCH_ONLY_SIMILARITY_THRESHOLD &&
        cachedReferenceCoverage >= 0.34)
    ) {
      return {
        mode: "refresh_search_only",
        querySimilarityToLastTurn: similarity,
        cachedReferenceCoverage,
        candidateAmbiguity,
        candidateCount,
        topScoreMargin
      };
    }
    return {
      mode: "refresh_with_helper",
      querySimilarityToLastTurn: similarity,
      cachedReferenceCoverage,
      candidateAmbiguity,
      candidateCount,
      topScoreMargin
    };
  }

  buildCandidateSetHash(referenceIds: string[]): string | null {
    return referenceIds.length > 0 ? referenceIds.join("|") : null;
  }

  private computeCachedReferenceCoverage(
    state: SkillRetrievalState | null,
    candidateReferenceIds: string[]
  ): number {
    if (
      state === null ||
      state.lastTopReferenceIds.length === 0 ||
      candidateReferenceIds.length === 0
    ) {
      return 0;
    }
    const next = new Set(candidateReferenceIds);
    let overlap = 0;
    for (const referenceId of state.lastTopReferenceIds) {
      if (next.has(referenceId)) {
        overlap += 1;
      }
    }
    return (
      overlap /
      Math.max(1, Math.min(state.lastTopReferenceIds.length, candidateReferenceIds.length))
    );
  }

  private computeQuerySimilarity(left: string, right: string): number {
    const leftTokens = this.tokenize(left);
    const rightTokens = this.tokenize(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) {
      return 0;
    }
    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }
    return overlap / Math.max(leftTokens.size, rightTokens.size);
  }

  private tokenize(value: string): Set<string> {
    return new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    );
  }
}
