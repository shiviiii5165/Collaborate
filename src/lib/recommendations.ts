import { db } from './db';
import { RecommendationMatch } from './types';
import { recommend, projectCollaborators, type MatchCategory, type MatchContext } from '@/modules/intelligence/matching';

/** Store-backed context for the matching engine. */
export function matchContext(): MatchContext {
  return {
    getMember: (id) => db.getMemberById(id),
    allMembers: () => db.getAllMembers(),
    isBlocked: (a, b) => db.isBlocked(a, b),
    isConnected: (a, b) => db.getConnectionState(a, b)?.status === 'accepted',
    acceptedConnectionIds: (id) =>
      db
        .getAllConnections()
        .filter((c) => c.status === 'accepted' && (c.requesterId === id || c.recipientId === id))
        .map((c) => (c.requesterId === id ? c.recipientId : c.requesterId)),
  };
}

/**
 * Recommendations in the existing RecommendationMatch shape (the UI reads member, reason,
 * mutualCount), now produced by the explainable engine with evidence attached.
 */
export function getRecommendationsForMember(
  viewerId: string,
  limit: number = 6,
  category: MatchCategory = 'all'
): RecommendationMatch[] {
  return recommend(viewerId, matchContext(), { limit, category }).map((r) => ({
    member: r.member,
    matchScore: r.score,
    reason: r.explanation.summary,
    sharedInterests: [...r.explanation.sharedSkills, ...r.explanation.complementarySkills],
    mutualCount: r.mutualCount,
    explanation: r.explanation,
    categories: r.categories,
  }));
}

export function getProjectCollaborators(viewerId: string, projectId: string, limit = 6) {
  return projectCollaborators(viewerId, projectId, matchContext(), limit);
}
