import { db } from './db';
import { MemberProfile, RecommendationMatch } from './types';

export function getRecommendationsForMember(
  viewerId: string,
  limit: number = 6
): RecommendationMatch[] {
  const viewer = db.members.get(viewerId);
  if (!viewer) return [];

  const candidates: RecommendationMatch[] = [];

  for (const candidate of db.members.values()) {
    // 1. Exclude self and admin
    if (candidate.id === viewerId || candidate.role === 'admin') continue;

    // 2. Safety & block checks
    if (db.isBlocked(viewerId, candidate.id) || db.isBlocked(candidate.id, viewerId)) continue;
    if (candidate.isRestricted) continue;

    // Student safeguarding: under-18 accounts are isolated from non-safeguarded adult accounts
    if (candidate.isUnder18 && !viewer.safeguardingApproved && !viewer.isUnder18) continue;

    // 3. Discoverability check
    if (!candidate.discoverable || candidate.profileVisibility === 'private') continue;

    // 4. If already connected, do not recommend in discover new people
    const conn = db.getConnectionState(viewerId, candidate.id);
    if (conn && conn.status === 'accepted') continue;

    // 5. Calculate genuine shared overlaps
    const viewerSkills = new Set(viewer.skills.map((s) => s.toLowerCase()));
    const candidateSkills = new Set(candidate.skills.map((s) => s.toLowerCase()));
    const sharedSkills = Array.from(viewerSkills).filter((s) => candidateSkills.has(s));

    const viewerInterests = new Set((viewer.collaborationInterests || []).map((i) => i.toLowerCase()));
    const candidateInterests = new Set(
      (candidate.collaborationInterests || []).map((i) => i.toLowerCase())
    );
    const sharedInterests = Array.from(viewerInterests).filter((i) =>
      candidateInterests.has(i)
    );

    const viewerSpecializations = new Set(
      (viewer.aiSpecializations || []).map((sp) => sp.toLowerCase())
    );
    const candidateSpecializations = new Set(
      (candidate.aiSpecializations || []).map((sp) => sp.toLowerCase())
    );
    const sharedSpecializations = Array.from(viewerSpecializations).filter((sp) =>
      candidateSpecializations.has(sp)
    );

    // Project areas overlap
    const viewerProjectTags = new Set(
      (viewer.projects || []).flatMap((p) => (p.tags || []).map((t) => t.toLowerCase()))
    );
    const candidateProjectTags = new Set(
      (candidate.projects || []).flatMap((p) => (p.tags || []).map((t) => t.toLowerCase()))
    );
    const sharedProjectAreas = Array.from(viewerProjectTags).filter((t) => candidateProjectTags.has(t));

    // Mutual connections count from real connection records
    let mutualCount = 0;
    for (const [, connection] of db.connections.entries()) {
      if (connection.status === 'accepted') {
        const otherParty =
          connection.requesterId === candidate.id
            ? connection.recipientId
            : connection.recipientId === candidate.id
            ? connection.requesterId
            : null;
        if (otherParty && otherParty !== viewerId) {
          const viewerConn = db.getConnectionState(viewerId, otherParty);
          if (viewerConn && viewerConn.status === 'accepted') {
            mutualCount++;
          }
        }
      }
    }

    let matchScore = 10;
    const explanationParts: string[] = [];

    if (sharedSpecializations.length > 0) {
      matchScore += sharedSpecializations.length * 25;
      explanationParts.push(
        `shared focus in ${sharedSpecializations
          .slice(0, 2)
          .map((s) => s.toUpperCase())
          .join(' and ')}`
      );
    }

    if (sharedInterests.length > 0) {
      matchScore += sharedInterests.length * 20;
      explanationParts.push(`mutual interest in ${sharedInterests[0]}`);
    } else if (candidate.collaborationInterests && candidate.collaborationInterests.length > 0) {
      matchScore += 10;
      explanationParts.push(`open to ${candidate.collaborationInterests[0]}`);
    }

    if (sharedSkills.length > 0) {
      matchScore += sharedSkills.length * 5;
      if (explanationParts.length < 2) {
        explanationParts.push(
          `mutual proficiency in ${sharedSkills.slice(0, 3).join(', ')}`
        );
      }
    }

    if (sharedProjectAreas.length > 0) {
      matchScore += sharedProjectAreas.length * 15;
      if (explanationParts.length < 2) {
        explanationParts.push(`complementary project experience in ${sharedProjectAreas.slice(0, 2).join(', ')}`);
      }
    }

    if (mutualCount > 0) {
      matchScore += mutualCount * 12;
      explanationParts.push(`${mutualCount} mutual connection${mutualCount > 1 ? 's' : ''}`);
    }

    // Build truthful explainability sentence
    let reason = '';
    if (explanationParts.length > 0) {
      reason = `${explanationParts.join('; ')}.`;
    } else if (candidate.skills && candidate.skills.length > 0) {
      reason = `Complementary technical background in ${candidate.headline ? candidate.headline.split('|')[0].trim() : candidate.skills.slice(0, 2).join(', ')}.`;
    } else {
      reason = 'New member in Collaborate network open to professional networking.';
    }

    candidates.push({
      member: candidate,
      matchScore,
      reason,
      sharedInterests: Array.from(new Set([...sharedSpecializations, ...sharedSkills, ...sharedProjectAreas])),
      mutualCount,
    });
  }

  // Sort descending by match score
  candidates.sort((a, b) => b.matchScore - a.matchScore);

  // Deduplicate by name to prevent multiple test accounts with identical names from crowding the recommendation rail
  const seenNames = new Set<string>();
  const uniqueCandidates: RecommendationMatch[] = [];
  for (const c of candidates) {
    const key = c.member.fullName.toLowerCase().trim();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      uniqueCandidates.push(c);
    }
  }

  return uniqueCandidates.slice(0, limit);
}
