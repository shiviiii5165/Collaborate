/**
 * ProfessionalProjectionV1: the profile AI Tathastu actually sends.
 *
 * Mirrors ai-tathastu/src/lib/integrations/projection.ts (toProfessionalProjectionV1).
 * A section the user has not shared is `null` and listed in privacy.masked.
 *
 * Validation is strict on structure and types. Unknown keys are stripped, so fields
 * AI Tathastu adds later can never leak into Collaborate storage without a contract change.
 * The `activity` section is deliberately not parsed: Collaborate does not request or
 * import GitHub activity (decided 2026-11-04).
 */
import { z } from 'zod';

export const PROJECTION_SCHEMA = 'ProfessionalProjectionV1';
export const PROJECTION_VERSION = 1;

const str = z.string();
const nullableStr = z.string().nullable().optional().transform((v) => v ?? null);
const sources = z.array(z.string()).optional().default([]);

const IdentitySchema = z.object({
  id: str.min(1),
  // Present in the source; parsed only so a malformed value is rejected. Never stored.
  email: z.string().nullable().optional(),
  name: nullableStr,
  headline: nullableStr,
  avatarUrl: nullableStr,
  careerRole: z.object({ id: str, label: str }).nullable().optional().transform((v) => v ?? null),
  careerRoleOther: nullableStr,
  location: z
    .object({ city: nullableStr, country: nullableStr })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const EducationSchema = z.object({
  institution: nullableStr,
  degree: nullableStr,
  fieldOfStudy: nullableStr,
  dates: nullableStr,
  grade: nullableStr,
  sources,
});

const SkillItemSchema = z.object({
  name: str.min(1),
  category: nullableStr,
  evidenceStrength: z.number().nullable().optional().transform((v) => v ?? null),
  verified: z.boolean().optional().default(false),
  verificationStatus: nullableStr,
  sources,
});

const ErisSchema = z.object({
  score: z.number(),
  role: nullableStr,
  gaps: z.array(z.unknown()).optional().default([]),
  computedAt: nullableStr,
});

const SkillsSchema = z.object({
  items: z.array(SkillItemSchema),
  erisReadiness: ErisSchema.nullable().optional().transform((v) => v ?? null),
});

const ProjectSchema = z.object({
  key: str.min(1),
  title: str.min(1),
  description: nullableStr,
  technologies: z.array(z.string()).optional().default([]),
  links: z.array(z.string()).optional().default([]),
  status: nullableStr,
  sources,
});

const ExperienceSchema = z.object({
  organization: nullableStr,
  role: nullableStr,
  dates: nullableStr,
  description: nullableStr,
  sources,
});

const AchievementSchema = z.object({
  type: z.enum(['achievement', 'certification', 'publication']),
  title: str.min(1),
  issuer: nullableStr,
  date: nullableStr,
  description: nullableStr,
  url: nullableStr,
  sources,
});

const PrivacySchema = z.object({
  scopes: z.record(z.string(), z.boolean()),
  masked: z.array(z.string()),
  hiddenProjects: z.number().optional().default(0),
  consentUpdatedAt: nullableStr,
});

/** A section is either shared (array/object) or explicitly withheld (null). Missing = withheld. */
const section = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullable().optional().transform((v) => (v === undefined ? null : v));

export const ProfessionalProjectionV1Schema = z.object({
  schema: z.literal(PROJECTION_SCHEMA),
  version: z.literal(PROJECTION_VERSION),
  audience: str,
  generatedAt: z.iso.datetime({ offset: true }),
  identity: IdentitySchema,
  education: section(z.array(EducationSchema)),
  skills: section(SkillsSchema),
  projects: section(z.array(ProjectSchema)),
  experience: section(z.array(ExperienceSchema)),
  achievements: section(z.array(AchievementSchema)),
  privacy: PrivacySchema,
});

export type ProfessionalProjectionV1 = z.output<typeof ProfessionalProjectionV1Schema>;

export class ProjectionContractError extends Error {
  public readonly code: 'UNSUPPORTED_PROJECTION_SCHEMA' | 'INVALID_PROJECTION';
  public readonly issues: string[];
  constructor(code: ProjectionContractError['code'], issues: string[]) {
    super(`${code}: ${issues.slice(0, 5).join('; ')}`);
    this.name = 'ProjectionContractError';
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Parses an untrusted payload. Throws ProjectionContractError:
 *  - UNSUPPORTED_PROJECTION_SCHEMA when schema/version is not one we understand,
 *  - INVALID_PROJECTION when the structure does not match.
 */
export function parseProjectionV1(input: unknown, expectedAudience?: string): ProfessionalProjectionV1 {
  if (!input || typeof input !== 'object') {
    throw new ProjectionContractError('INVALID_PROJECTION', ['payload is not an object']);
  }
  const raw = input as Record<string, unknown>;
  if (raw.schema !== PROJECTION_SCHEMA || raw.version !== PROJECTION_VERSION) {
    throw new ProjectionContractError('UNSUPPORTED_PROJECTION_SCHEMA', [
      `expected ${PROJECTION_SCHEMA} v${PROJECTION_VERSION}, received ${String(raw.schema)} v${String(raw.version)}`,
    ]);
  }
  const result = ProfessionalProjectionV1Schema.safeParse(input);
  if (!result.success) {
    throw new ProjectionContractError(
      'INVALID_PROJECTION',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    );
  }
  if (expectedAudience && result.data.audience !== expectedAudience) {
    throw new ProjectionContractError('INVALID_PROJECTION', [
      `audience '${result.data.audience}' does not match '${expectedAudience}'`,
    ]);
  }
  return result.data;
}
