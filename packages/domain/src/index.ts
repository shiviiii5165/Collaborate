/**
 * Collaborate. by AI Tathastu — Shared Domain Logic Package
 * @package @collaborate/domain
 *
 * Implements authoritative business rules, student safeguarding boundaries,
 * quota rules, recommendation scoring, and security algorithms.
 */

import type { MemberProfile, RecommendationMatch } from '@collaborate/contracts';

export const DAILY_FREE_PROFILE_VIEW_LIMIT = 3;

/**
 * Student Safeguarding Policy
 * Enforces strict boundaries regarding under-18 members:
 * 1. Under-18 accounts are private by default.
 * 2. Adult members cannot initiate unsolicited contact with minors.
 * 3. Institutional affiliation alone does not bypass this boundary.
 */
export function isPrivateByDefault(isUnder18?: boolean): boolean {
  return Boolean(isUnder18);
}

export function canInitiateContact(
  sender: { id: string; isUnder18?: boolean; role?: string },
  recipient: { id: string; isUnder18?: boolean }
): { allowed: boolean; reason?: string } {
  if (sender.id === recipient.id) {
    return { allowed: true };
  }

  // Adult contacting a minor without prior consent
  if (!sender.isUnder18 && recipient.isUnder18) {
    return {
      allowed: false,
      reason: 'SAFEGUARDING_RESTRICTION: Direct adult-to-minor contact is restricted without prior institutional authorization.'
    };
  }

  return { allowed: true };
}

/**
 * Recommendation Engine Deduplication & Scoring
 * Ensures candidates are scored purely on factual attributes and
 * deduplicated strictly by stable member ID.
 */
export function deduplicateRecommendations(matches: RecommendationMatch[]): RecommendationMatch[] {
  const seenIds = new Set<string>();
  const unique: RecommendationMatch[] = [];

  for (const match of matches) {
    if (!seenIds.has(match.member.id)) {
      seenIds.add(match.member.id);
      unique.push(match);
    }
  }

  return unique;
}

// Password hashing lives in src/lib/auth/password.ts (asynchronous scrypt). The synchronous duplicates
// that used to be here blocked the server thread and threw on a missing password; they were removed.
