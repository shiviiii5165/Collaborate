/**
 * Builds payloads in the exact shape AI Tathastu's toProfessionalProjectionV1 emits
 * (ai-tathastu/src/lib/integrations/projection.ts). Sections default to "not shared" (null)
 * with privacy.masked and privacy.scopes kept consistent, as the source does.
 */
const SECTIONS = ['education', 'skills', 'projects', 'experience', 'achievements', 'activity'];

export function projectionV1({
  sub,
  email = `${sub}@example.test`,
  name = 'Test Member',
  headline = null,
  avatarUrl = null,
  location = null,
  careerRole = null,
  generatedAt = new Date().toISOString(),
  audience = 'collaborate',
  skills, // array of { name, category?, verified?, evidenceStrength? } or undefined (not shared)
  eris, // { score, role, gaps } or undefined
  projects, // array of { key, title, description?, technologies?, links? }
  experience, // array of { organization, role, dates?, description? }
  education, // array of { institution, degree, fieldOfStudy?, dates?, grade? }
  achievements, // array of { type, title, issuer?, date?, url? }
  activity, // { repositories?, recent: [{ name, url?, stars?, languages?, lastCommitAt? }], connectedSources? }
} = {}) {
  const shared = {
    skills: skills !== undefined,
    projects: projects !== undefined,
    experience: experience !== undefined,
    education: education !== undefined,
    achievements: achievements !== undefined,
    eris: eris !== undefined,
    activity: activity !== undefined,
  };
  const p = {
    schema: 'ProfessionalProjectionV1',
    version: 1,
    audience,
    generatedAt,
    identity: {
      id: sub,
      email,
      name,
      headline,
      avatarUrl,
      careerRole,
      careerRoleOther: null,
      location: location ? { city: location.city ?? null, country: location.country ?? null } : { city: null, country: null },
      university: null,
      persona: 'student',
      department: null,
      academicTitle: null,
      company: null,
      jobTitle: null,
      graduationYear: null,
    },
    education: shared.education
      ? education.map((e) => ({ institution: e.institution ?? null, degree: e.degree ?? null, fieldOfStudy: e.fieldOfStudy ?? null, dates: e.dates ?? null, grade: e.grade ?? null, sources: ['resume'] }))
      : null,
    skills: shared.skills
      ? {
          items: skills.map((s) => ({
            name: s.name,
            category: s.category ?? 'other',
            evidenceStrength: s.evidenceStrength ?? 0.5,
            verified: Boolean(s.verified),
            verificationStatus: s.verified ? 'verified' : 'self_reported',
            sources: ['github'],
          })),
          erisReadiness: shared.eris ? { score: eris.score, role: eris.role ?? null, byRole: {}, gaps: eris.gaps ?? [], computedAt: generatedAt } : null,
        }
      : null,
    projects: shared.projects
      ? projects.map((pr) => ({ key: pr.key, title: pr.title, description: pr.description ?? null, technologies: pr.technologies ?? [], links: pr.links ?? [], status: 'active', sources: ['github'] }))
      : null,
    experience: shared.experience
      ? experience.map((e) => ({ organization: e.organization ?? null, role: e.role ?? null, dates: e.dates ?? null, description: e.description ?? null, sources: ['resume'] }))
      : null,
    achievements: shared.achievements
      ? achievements.map((a) => ({ type: a.type ?? 'achievement', title: a.title, issuer: a.issuer ?? null, date: a.date ?? null, description: null, url: a.url ?? null, sources: ['resume'] }))
      : null,
    activity: shared.activity
      ? {
          connectedSources: activity.connectedSources ?? ['github'],
          github: { repositories: activity.repositories ?? activity.recent.length, recent: activity.recent.map((r) => ({ name: r.name, url: r.url ?? null, stars: r.stars ?? 0, languages: r.languages ?? [], lastCommitAt: r.lastCommitAt ?? null })) },
          profileUpdatedAt: generatedAt,
        }
      : null,
    privacy: { scopes: shared, masked: [], hiddenProjects: 0, consentUpdatedAt: generatedAt },
  };
  p.privacy.masked = [
    ...SECTIONS.filter((s) => p[s] === null),
    ...(p.skills && !p.skills.erisReadiness ? ['skills.erisReadiness'] : []),
  ];
  return p;
}
