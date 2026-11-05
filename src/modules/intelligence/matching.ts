/**
 * Explainable multi-dimensional matching.
 *
 * 1. Hard eligibility (never ranked away, always filtered): self, blocks in either direction,
 *    discoverability / visibility / safeguarding / account status (isVisibleInDiscovery),
 *    already-connected (for "new people"), the candidate's opt-out, the viewer's dismissals.
 * 2. Relevance: each dimension yields a value in [0,1] plus evidence. A dimension counts only
 *    when BOTH members have the data it needs; the score is the weighted mean over those
 *    dimensions. A sparse (e.g. independent) profile is therefore not penalized for data it
 *    does not have; instead its `confidence` is lower and `unknowns` say what is missing.
 * 3. `score` is a relative ranking value (0-100) for ordering, NOT a probability or a claim of
 *    compatibility. Every reason shown is backed by an evidence entry.
 *
 * Deterministic, no AI calls: nothing here can fail because an AI service is down.
 */
import type { MemberProfile } from '@collaborate/contracts';
import { isVisibleInDiscovery } from '@/modules/profile/public-member';
import { getProfileIntelligence, type ProfileIntelligence } from './profile-intelligence';
import { candidateStrength, skillRarity, viewerGoals } from './goals';
import { domainsForSkill, normalizeSkill } from './skills';

export type MatchCategory =
  | 'all'
  | 'similar_expertise'
  | 'complementary_expertise'
  | 'project_collaborators'
  | 'domain_specialists'
  | 'mentors'
  | 'cofounders';

export const MATCH_CATEGORIES: MatchCategory[] = [
  'all',
  'similar_expertise',
  'complementary_expertise',
  'project_collaborators',
  'domain_specialists',
  'mentors',
  'cofounders',
];

export type DimensionKey =
  | 'goal_help'
  | 'shared_expertise'
  | 'complementary_skills'
  | 'project_technology'
  | 'domain'
  | 'interests'
  | 'collaboration_intent'
  | 'experience'
  | 'skill_evidence'
  | 'mutual_connections';

// v2 (2026-11): help with the member's own goals leads; plain similarity counts much less, so a
// "same skills, same title" member no longer outranks someone who can actually help.
const WEIGHTS: Record<DimensionKey, number> = {
  goal_help: 5,
  shared_expertise: 1,
  complementary_skills: 3,
  project_technology: 2.5,
  domain: 1.5,
  interests: 2,
  collaboration_intent: 1,
  experience: 1,
  skill_evidence: 1,
  mutual_connections: 1,
};

export interface DimensionResult {
  key: DimensionKey;
  value: number; // 0..1
  evidence: string[];
}

export interface MatchExplanation {
  summary: string;
  dimensions: DimensionResult[];
  sharedSkills: string[];
  complementarySkills: string[];
  possibleCollaboration: string | null;
  unknowns: string[];
  /** How much evidence the ranking rests on (number of dimensions both profiles had data for). */
  confidence: 'low' | 'medium' | 'high';
  /** Collaboration compatibility (shared interests, stated intent, mutual connections), kept apart from relevance. */
  compatibility: 'unknown' | 'low' | 'medium' | 'high';
  /** Skills from your goals this member has credible evidence for, strongest first. */
  helpsWith: { skill: string; evidence: string }[];
  scoreMeaning: 'relative ranking within your results, not a probability';
}

export interface MatchResult {
  member: MemberProfile;
  score: number;
  categories: MatchCategory[];
  mutualCount: number;
  explanation: MatchExplanation;
}

export interface MatchContext {
  getMember: (id: string) => MemberProfile | null;
  allMembers: () => MemberProfile[];
  isBlocked: (a: string, b: string) => boolean;
  isConnected: (a: string, b: string) => boolean;
  acceptedConnectionIds: (id: string) => string[];
  /** How many members list each canonical skill (filled by recommend() for rarity weighting). */
  skillFrequency?: { df: Map<string, number>; total: number };
}

const lc = (s: string) => s.trim().toLowerCase();
const MENTOR_OFFER = /\b(mentor|mentoring|mentorship|guide|guiding)\b/i;
const MENTOR_SEEK = /\b(mentor|mentorship|learn|learning|guidance|career advice)\b/i;
const COFOUNDER = /\b(co-?founder|cofounding|startup|start-up|founding team)\b/i;

const has = (list: string[], re: RegExp) => list.some((s) => re.test(s));
const top = (xs: string[], n = 3) => xs.slice(0, n);

/** Hard filter shared by every recommendation surface. */
export function isEligibleCandidate(
  viewer: MemberProfile,
  candidate: MemberProfile,
  ctx: Pick<MatchContext, 'isBlocked' | 'isConnected'>,
  opts: { excludeConnected?: boolean } = {}
): boolean {
  if (candidate.id === viewer.id) return false;
  if (ctx.isBlocked(viewer.id, candidate.id) || ctx.isBlocked(candidate.id, viewer.id)) return false;
  const connected = ctx.isConnected(viewer.id, candidate.id);
  if (opts.excludeConnected !== false && connected) return false;
  if (!isVisibleInDiscovery(candidate, viewer, connected)) return false;
  if (candidate.recommendationPreferences?.hideFromRecommendations) return false;
  if (viewer.recommendationPreferences?.dismissedMemberIds?.includes(candidate.id)) return false;
  return true;
}

function skillMap(intel: ProfileIntelligence) {
  return new Map(intel.skills.map((s) => [s.canonical, s]));
}

export function scoreCandidate(viewer: MemberProfile, candidate: MemberProfile, ctx: MatchContext): MatchResult {
  const vi = getProfileIntelligence(viewer);
  const ci = getProfileIntelligence(candidate);
  const vSkills = skillMap(vi);
  const cSkills = skillMap(ci);
  const dims: DimensionResult[] = [];
  const unknowns: string[] = [];
  const freq = ctx.skillFrequency;
  const rarity = (k: string) => (freq ? skillRarity(freq.df, freq.total, k) : 1);

  // 0. Help with your goals: credible evidence in skills your target role still needs from you.
  const goals = viewerGoals(viewer, vi);
  const helpsWith: { skill: string; evidence: string; points: number }[] = [];
  if (goals.needs.length) {
    const totalNeed = goals.needs.slice(0, 5).reduce((s, n) => s + n.weight, 0);
    let got = 0;
    for (const need of goals.needs) {
      const s = cSkills.get(need.canonical);
      if (!s) continue;
      const strength = candidateStrength(candidate, s);
      const points = need.weight * strength.value * rarity(need.canonical);
      got += points;
      helpsWith.push({ skill: s.name, evidence: strength.label, points });
    }
    helpsWith.sort((a, b) => b.points - a.points);
    const forRole = goals.roleLabel ? ` your ${goals.roleLabel} goal needs` : ' you are working on';
    if (cSkills.size) {
      dims.push({
        key: 'goal_help',
        value: Math.min(1, got / Math.max(0.0001, totalNeed * 0.6)),
        evidence: helpsWith.slice(0, 3).map((h) => `Strong evidence in ${h.skill} (${h.evidence}), a skill${forRole}`),
      });
    }
  }

  // A. Shared expertise (rarity-weighted: sharing a skill everyone has says little)
  const shared = [...cSkills.keys()].filter((k) => vSkills.has(k));
  if (vSkills.size && cSkills.size) {
    const sharedPoints = shared.reduce((s, k) => s + rarity(k), 0);
    dims.push({
      key: 'shared_expertise',
      value: Math.min(1, sharedPoints / 3),
      evidence: shared.length ? [`Both list ${top(shared.map((k) => cSkills.get(k)!.name)).join(', ')}`] : [],
    });
  } else unknowns.push(cSkills.size ? 'You have not listed skills yet' : 'This member has not listed skills');

  // B. Complementary skills: candidate skills you lack, in domains you work in, or covering
  //    technologies your projects use that you do not list as skills.
  const vDomains = new Set(vi.domains.map((d) => d.domain));
  const vProjectTech = new Set(vi.technologies.map((t) => t.canonical));
  const complementary: string[] = [];
  const compEvidence: string[] = [];
  for (const [k, s] of cSkills) {
    if (vSkills.has(k)) continue;
    const projectGap = vProjectTech.has(k);
    const domainHit = domainsForSkill(k).find((d) => vDomains.has(d));
    if (!projectGap && !domainHit) continue;
    complementary.push(s.name);
    const proof = s.evidence.find((e) => e.startsWith('Verified') || e.startsWith('Used in')) ?? s.evidence[0];
    compEvidence.push(projectGap ? `${s.name}: used in your projects but not in your skills (${proof})` : `${s.name} adds to your ${domainHit} work (${proof})`);
  }
  if ((vDomains.size || vProjectTech.size) && cSkills.size) {
    const compPoints = complementary.reduce((s, n) => s + rarity(normalizeSkill(n)), 0);
    dims.push({ key: 'complementary_skills', value: Math.min(1, compPoints / 3), evidence: top(compEvidence) });
  }

  // C. Project & technology compatibility
  const cProjectTech = new Set(ci.technologies.map((t) => t.canonical));
  if (vProjectTech.size && cProjectTech.size) {
    const overlap = [...cProjectTech].filter((t) => vProjectTech.has(t));
    const names = overlap.map((t) => ci.technologies.find((x) => x.canonical === t)!.name);
    const where = overlap[0] ? ci.technologies.find((x) => x.canonical === overlap[0])!.projects[0] : null;
    dims.push({
      key: 'project_technology',
      value: Math.min(1, overlap.length / 3),
      evidence: overlap.length ? [`Projects share ${top(names).join(', ')}${where ? ` (e.g. "${where}")` : ''}`] : [],
    });
  } else if (!cProjectTech.size) unknowns.push('No projects listed by this member');

  // D. Domain
  const cDomains = new Map(ci.domains.map((d) => [d.domain, d]));
  if (vDomains.size && cDomains.size) {
    const sharedDomains = [...vDomains].filter((d) => cDomains.has(d));
    dims.push({
      key: 'domain',
      value: Math.min(1, sharedDomains.length / 2),
      evidence: sharedDomains.map((d) => `${d} (derived from ${top(cDomains.get(d)!.evidence, 2).join(', ')})`),
    });
  }

  // E. Interests (user-provided interests and specializations)
  const vInt = new Set([...vi.intents, ...vi.interests].map(lc));
  const cIntList = [...ci.intents, ...ci.interests];
  if (vInt.size && cIntList.length) {
    const sharedInt = cIntList.filter((i) => vInt.has(lc(i)));
    dims.push({ key: 'interests', value: Math.min(1, sharedInt.length / 2), evidence: sharedInt.length ? [`Shared interest in ${top(sharedInt, 2).join(', ')}`] : [] });
  } else if (!cIntList.length) unknowns.push('Collaboration interests not stated by this member');

  // F. Collaboration intent (explicit only)
  if (ci.intents.length) {
    dims.push({ key: 'collaboration_intent', value: 1, evidence: [`Open to ${ci.intents[0]}`] });
  }

  // G. Experience relevance: same role family or organization
  if (vi.experience.length && ci.experience.length) {
    const vRoles = new Set(vi.experience.map((e) => lc(e.role)).filter(Boolean));
    const vOrgs = new Set(vi.experience.map((e) => lc(e.company)).filter(Boolean));
    const hits = ci.experience.filter((e) => vRoles.has(lc(e.role)) || vOrgs.has(lc(e.company)));
    dims.push({ key: 'experience', value: hits.length ? 1 : 0, evidence: hits.slice(0, 2).map((e) => `${e.role} at ${e.company}`) });
  }

  // H. Demonstrated evidence behind the matched skills (verified at source or used in projects)
  const matched = [...new Set([...shared, ...complementary.map(normalizeSkill)])];
  if (matched.length) {
    const strong = matched.map((k) => cSkills.get(k)).filter((s) => s && s.confidence === 'high');
    dims.push({ key: 'skill_evidence', value: strong.length / matched.length, evidence: strong.slice(0, 3).map((s) => `${s!.name}: ${s!.evidence[0]}`) });
  }

  // I. Mutual connections
  const vConns = new Set(ctx.acceptedConnectionIds(viewer.id));
  const mutual = ctx.acceptedConnectionIds(candidate.id).filter((id) => id !== viewer.id && vConns.has(id));
  if (vConns.size) {
    dims.push({ key: 'mutual_connections', value: Math.min(1, mutual.length / 3), evidence: mutual.length ? [`${mutual.length} mutual connection${mutual.length > 1 ? 's' : ''}`] : [] });
  }

  const assessed = dims.filter((d) => d.key !== 'collaboration_intent' || dims.length > 1);
  const weightSum = assessed.reduce((s, d) => s + WEIGHTS[d.key], 0);
  const raw = weightSum ? assessed.reduce((s, d) => s + WEIGHTS[d.key] * d.value, 0) / weightSum : 0;
  const score = Math.round(raw * 100);
  const confidence = assessed.length >= 5 ? 'high' : assessed.length >= 3 ? 'medium' : 'low';
  const compat = dims.filter((d) => d.key === 'interests' || d.key === 'collaboration_intent' || d.key === 'mutual_connections');
  const compatValue = compat.length ? compat.reduce((s, d) => s + d.value, 0) / compat.length : null;
  const compatibility = compatValue === null ? 'unknown' : compatValue >= 0.66 ? 'high' : compatValue >= 0.33 ? 'medium' : 'low';

  // Categories (only when evidence supports them)
  const categories: MatchCategory[] = ['all'];
  if (helpsWith.length) categories.push('complementary_expertise');
  if (shared.length || dims.find((d) => d.key === 'domain' && d.value > 0)) categories.push('similar_expertise');
  if (complementary.length && !categories.includes('complementary_expertise')) categories.push('complementary_expertise');
  if (dims.find((d) => d.key === 'project_technology' && d.value > 0) || complementary.some((s) => vProjectTech.has(normalizeSkill(s)))) categories.push('project_collaborators');
  if (ci.domains.some((d) => d.confidence === 'high' && vDomains.has(d.domain))) categories.push('domain_specialists');
  if (has(ci.intents, MENTOR_OFFER) && has(vi.intents, MENTOR_SEEK)) categories.push('mentors');
  if (has(ci.intents, COFOUNDER) && has(vi.intents, COFOUNDER)) categories.push('cofounders');

  const reasons = dims.filter((d) => d.value > 0 && d.evidence.length).sort((a, b) => WEIGHTS[b.key] * b.value - WEIGHTS[a.key] * a.value);
  const summary = reasons.length
    ? `${reasons.slice(0, 2).map((d) => d.evidence[0]).join('; ')}.`
    : 'Few overlapping details yet; shown because this member is open to networking.';

  let possibleCollaboration: string | null = null;
  if (complementary.length && vi.projects.length) possibleCollaboration = `${candidate.fullName} could contribute ${top(complementary, 2).join(' and ')} to "${vi.projects[0].title}".`;
  else if (categories.includes('cofounders')) possibleCollaboration = 'Both of you state interest in building a startup.';
  else if (shared.length && ci.intents.length) possibleCollaboration = `Joint work on ${top(shared.map((k) => cSkills.get(k)!.name), 2).join(', ')} (${ci.intents[0]}).`;

  return {
    member: candidate,
    score,
    categories,
    mutualCount: mutual.length,
    explanation: {
      summary,
      dimensions: dims,
      sharedSkills: shared.map((k) => cSkills.get(k)!.name),
      complementarySkills: complementary,
      possibleCollaboration,
      unknowns,
      confidence,
      compatibility,
      helpsWith: helpsWith.slice(0, 5).map(({ skill, evidence }) => ({ skill, evidence })),
      scoreMeaning: 'relative ranking within your results, not a probability',
    },
  };
}

/**
 * Ranked recommendations for `viewerId`. Cold start: when the viewer has no profile data to
 * compare, candidates are ordered by how much evidence they have and the explanation says so.
 */
export function recommend(
  viewerId: string,
  ctx: MatchContext,
  opts: { category?: MatchCategory; limit?: number; excludeConnected?: boolean } = {}
): MatchResult[] {
  const viewer = ctx.getMember(viewerId);
  if (!viewer) return [];
  const category = opts.category ?? 'all';
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 50));
  const vi = getProfileIntelligence(viewer);
  // A member with a goal but no skills yet is not cold: their goal is exactly what to match on.
  const coldStart = vi.skills.length === 0 && vi.projects.length === 0 && vi.intents.length === 0 && vi.interests.length === 0 && viewerGoals(viewer, vi).needs.length === 0;

  // Skill frequency over everyone the viewer could be shown, for rarity weighting.
  const eligible = ctx.allMembers().filter((c) => isEligibleCandidate(viewer, c, ctx, { excludeConnected: opts.excludeConnected }));
  const df = new Map<string, number>();
  for (const c of eligible) for (const s of getProfileIntelligence(c).skills) df.set(s.canonical, (df.get(s.canonical) ?? 0) + 1);
  const scored: MatchContext = { ...ctx, skillFrequency: { df, total: eligible.length } };

  const results: MatchResult[] = [];
  for (const c of eligible) {
    const r = scoreCandidate(viewer, c, scored);
    if (coldStart) {
      const ci = getProfileIntelligence(c);
      r.score = Math.round(ci.completeness.score * 100);
      r.explanation.summary = 'Your profile has no skills or interests yet, so this is a general suggestion. Add skills to get matched on real evidence.';
      r.explanation.confidence = 'low';
      r.explanation.unknowns.unshift('Your own profile is empty');
    }
    if (!r.categories.includes(category)) continue;
    if (!coldStart && category === 'all' && r.score === 0 && r.mutualCount === 0 && !r.explanation.dimensions.some((d) => d.key === 'collaboration_intent')) continue;
    results.push(r);
  }
  results.sort((a, b) => b.score - a.score || b.mutualCount - a.mutualCount || a.member.id.localeCompare(b.member.id));
  return results.slice(0, limit);
}

/**
 * People who could contribute to one of the viewer's OWN projects: those covering the
 * project's technologies the viewer does not list as skills (gaps), then those sharing them.
 * Only the viewer's project is used; no one is added or contacted.
 */
export function projectCollaborators(viewerId: string, projectId: string, ctx: MatchContext, limit = 6) {
  const viewer = ctx.getMember(viewerId);
  if (!viewer) return null;
  const project = (viewer.projects || []).find((p) => p.id === projectId);
  if (!project) return null;
  const vi = getProfileIntelligence(viewer);
  const own = new Set(vi.skills.map((s) => s.canonical));
  const required = (project.tags || []).map((t) => ({ name: t, canonical: normalizeSkill(t) }));
  const gaps = required.filter((r) => !own.has(r.canonical));

  const out: { member: MemberProfile; score: number; covers: string[]; evidence: string[] }[] = [];
  for (const c of ctx.allMembers()) {
    if (!isEligibleCandidate(viewer, c, ctx, { excludeConnected: false })) continue;
    const ci = getProfileIntelligence(c);
    const cs = new Map(ci.skills.map((s) => [s.canonical, s]));
    const ct = new Map(ci.technologies.map((t) => [t.canonical, t]));
    const covers: string[] = [];
    const evidence: string[] = [];
    let points = 0;
    for (const r of required) {
      const s = cs.get(r.canonical);
      const t = ct.get(r.canonical);
      if (!s && !t) continue;
      const isGap = gaps.some((g) => g.canonical === r.canonical);
      points += isGap ? 2 : 1;
      covers.push(r.name);
      evidence.push(s ? `${r.name}: ${s.evidence[0]}` : `${r.name}: used in "${t!.projects[0]}"`);
    }
    if (!covers.length) continue;
    out.push({ member: c, score: Math.round((points / Math.max(1, required.length + gaps.length)) * 100), covers, evidence });
  }
  out.sort((a, b) => b.score - a.score || a.member.id.localeCompare(b.member.id));
  return {
    project: { id: project.id, title: project.title, technologies: required.map((r) => r.name) },
    missingCapabilities: gaps.map((g) => g.name),
    candidates: out.slice(0, limit),
  };
}
