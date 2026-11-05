/**
 * Profile intelligence: a structured, evidence-carrying understanding of a member, derived
 * deterministically from data Collaborate is allowed to hold (effective profile = local +
 * consented imports). No LLM call, no network, so it can never block login or profile views.
 *
 * Provenance labels (every item carries one):
 *   ai_tathastu_verified   imported from AI Tathastu and verified there
 *   ai_tathastu            imported from AI Tathastu (self-reported or unverified at source)
 *   collaborate            entered by the member in Collaborate
 *   derived                computed here from the items above (never presented as a fact)
 *
 * Nothing sensitive is inferred: domains come only from an explicit skill->domain table,
 * intents only from what the member wrote. Results are cached by a hash of the inputs, so an
 * unchanged profile is not reprocessed and any source change (import, edit, revocation)
 * invalidates the cache automatically.
 */
import crypto from 'crypto';
import type { MemberProfile } from '@collaborate/contracts';
import { domainsForSkill, normalizeSkill } from './skills';

export const INTELLIGENCE_VERSION = 1;

export type Provenance = 'ai_tathastu_verified' | 'ai_tathastu' | 'collaborate' | 'derived';
export type Confidence = 'low' | 'medium' | 'high';

export interface SkillInsight {
  name: string;
  canonical: string;
  provenance: Provenance;
  evidence: string[]; // human-readable, e.g. "Verified on AI Tathastu", "Used in project 'X'"
  confidence: Confidence;
}

export interface DomainInsight {
  domain: string;
  provenance: 'derived';
  evidence: string[]; // skills that place the member in this domain
  confidence: Confidence;
}

export interface ProfileIntelligence {
  version: number;
  memberId: string;
  sourceHash: string;
  skills: SkillInsight[];
  technologies: { canonical: string; name: string; projects: string[] }[];
  domains: DomainInsight[];
  projects: { id: string; title: string; technologies: string[]; provenance: Provenance }[];
  experience: { role: string; company: string; provenance: Provenance }[];
  education: { institution: string; degree: string; provenance: Provenance }[];
  /** Derived from imported GitHub activity (refreshed weekly); null when not shared. */
  activity: { lastActiveAt: string | null; activeLast90Days: boolean; languages: string[]; repositories: number } | null;
  /** User-provided only (collaborationInterests / aiSpecializations). */
  intents: string[];
  interests: string[];
  completeness: { score: number; present: string[]; missing: string[] };
}

const PLACEHOLDERS = new Set(['', 'new member | collaborate professional', 'professional profile on collaborate.']);

function provenanceOf(source: 'tathastu_core' | 'collaborate' | undefined): Provenance {
  return source === 'tathastu_core' ? 'ai_tathastu' : 'collaborate';
}

export function sourceHashOf(m: MemberProfile): string {
  const input = {
    v: INTELLIGENCE_VERSION,
    skills: m.skills,
    projects: (m.projects || []).map((p) => [p.id, p.title, p.tags, p.sourceOrigin]),
    experience: (m.experience || []).map((e) => [e.role, e.company, e.sourceOrigin]),
    education: (m.education || []).map((e) => [e.institution, e.degree, e.sourceOrigin]),
    imported: (m.importedProfile?.skills || []).map((s) => [s.name, s.verified, s.proficiency ?? null]),
    interests: m.collaborationInterests,
    spec: m.aiSpecializations,
    activity: (m.importedProfile?.activity?.recentRepositories || []).map((r) => [r.name, r.lastCommitAt, r.languages]),
    headline: m.headline,
    about: m.about,
  };
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 20);
}

const cache = new Map<string, ProfileIntelligence>();
const CACHE_LIMIT = 5000;

export function intelligenceCacheSize() {
  return cache.size;
}

export function getProfileIntelligence(m: MemberProfile): ProfileIntelligence {
  const hash = sourceHashOf(m);
  const hit = cache.get(m.id);
  if (hit && hit.sourceHash === hash) return hit;
  const built = buildProfileIntelligence(m, hash);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(m.id, built);
  return built;
}

/** Drops the cached insight for a member (e.g. after revocation); the next read rebuilds it. */
export function invalidateProfileIntelligence(memberId: string) {
  cache.delete(memberId);
}

export function buildProfileIntelligence(m: MemberProfile, hash = sourceHashOf(m)): ProfileIntelligence {
  const importedSkills = new Map((m.importedProfile?.skills || []).map((s) => [normalizeSkill(s.name), s]));
  const localSkills = new Set((m.localProfile?.skills || []).map(normalizeSkill));
  const projects = m.projects || [];

  // Technologies demonstrated in projects (evidence for skills).
  const techMap = new Map<string, { canonical: string; name: string; projects: string[] }>();
  for (const p of projects) {
    for (const t of p.tags || []) {
      const c = normalizeSkill(t);
      if (!c) continue;
      const e = techMap.get(c) ?? { canonical: c, name: t, projects: [] };
      if (!e.projects.includes(p.title)) e.projects.push(p.title);
      techMap.set(c, e);
    }
  }

  // GitHub repositories with a commit in the last 90 days, by language (evidence, never a fact).
  const act = m.importedProfile?.activity ?? null;
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  const recentByLanguage = new Map<string, string>();
  let lastActiveAt: string | null = null;
  const activeLanguages = new Set<string>();
  for (const r of act?.recentRepositories ?? []) {
    if (r.lastCommitAt && (!lastActiveAt || r.lastCommitAt > lastActiveAt)) lastActiveAt = r.lastCommitAt;
    if (!r.lastCommitAt || Date.parse(r.lastCommitAt) < ninetyDaysAgo) continue;
    for (const lang of r.languages) {
      const c = normalizeSkill(lang);
      activeLanguages.add(lang);
      if (!recentByLanguage.has(c)) recentByLanguage.set(c, r.name);
    }
  }

  const seen = new Set<string>();
  const skills: SkillInsight[] = [];
  for (const name of m.skills || []) {
    const canonical = normalizeSkill(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    const imp = importedSkills.get(canonical);
    const evidence: string[] = [];
    let provenance: Provenance = 'collaborate';
    if (imp && !localSkills.has(canonical)) {
      provenance = imp.verified ? 'ai_tathastu_verified' : 'ai_tathastu';
      evidence.push(imp.verified ? 'Verified on AI Tathastu' : 'Listed on AI Tathastu');
      if (imp.sources?.length) evidence.push(`Sources: ${imp.sources.join(', ')}`);
    } else {
      evidence.push('Listed by the member on Collaborate');
    }
    const usedIn = techMap.get(canonical)?.projects ?? [];
    for (const t of usedIn.slice(0, 3)) evidence.push(`Used in project "${t}"`);
    const recentRepo = recentByLanguage.get(canonical);
    if (recentRepo) evidence.push(`Recent GitHub work: "${recentRepo}" (last 90 days)`);
    const confidence: Confidence =
      provenance === 'ai_tathastu_verified' || usedIn.length >= 2 || (recentRepo && usedIn.length >= 1)
        ? 'high'
        : usedIn.length === 1 || recentRepo || provenance === 'ai_tathastu'
          ? 'medium'
          : 'low';
    skills.push({ name, canonical, provenance, evidence, confidence });
  }

  const domainEvidence = new Map<string, Set<string>>();
  const addDomain = (canonical: string, label: string) => {
    for (const d of domainsForSkill(canonical)) {
      if (!domainEvidence.has(d)) domainEvidence.set(d, new Set());
      domainEvidence.get(d)!.add(label);
    }
  };
  for (const s of skills) addDomain(s.canonical, s.name);
  for (const t of techMap.values()) addDomain(t.canonical, t.name);
  const domains: DomainInsight[] = [...domainEvidence.entries()]
    .map(([domain, ev]) => ({
      domain,
      provenance: 'derived' as const,
      evidence: [...ev],
      confidence: (ev.size >= 3 ? 'high' : ev.size === 2 ? 'medium' : 'low') as Confidence,
    }))
    .sort((a, b) => b.evidence.length - a.evidence.length);

  const present: string[] = [];
  const missing: string[] = [];
  const check = (label: string, ok: boolean) => (ok ? present : missing).push(label);
  check('headline', !PLACEHOLDERS.has((m.headline || '').trim().toLowerCase()));
  check('about', !PLACEHOLDERS.has((m.about || '').trim().toLowerCase()));
  check('skills', skills.length > 0);
  check('projects', projects.length > 0);
  check('experience', (m.experience || []).length > 0);
  check('education', (m.education || []).length > 0);
  check('collaboration interests', (m.collaborationInterests || []).length > 0);

  return {
    version: INTELLIGENCE_VERSION,
    memberId: m.id,
    sourceHash: hash,
    skills,
    technologies: [...techMap.values()],
    domains,
    projects: projects.map((p) => ({ id: p.id, title: p.title, technologies: p.tags || [], provenance: provenanceOf(p.sourceOrigin) })),
    experience: (m.experience || []).map((e) => ({ role: e.role, company: e.company, provenance: provenanceOf(e.sourceOrigin) })),
    education: (m.education || []).map((e) => ({ institution: e.institution, degree: e.degree, provenance: provenanceOf(e.sourceOrigin) })),
    activity: act
      ? {
          lastActiveAt,
          activeLast90Days: Boolean(lastActiveAt && Date.parse(lastActiveAt) >= ninetyDaysAgo),
          languages: [...activeLanguages],
          repositories: act.githubRepositories,
        }
      : null,
    intents: [...(m.collaborationInterests || [])],
    interests: [...(m.aiSpecializations || [])],
    completeness: { score: Math.round((present.length / (present.length + missing.length)) * 100) / 100, present, missing },
  };
}
