'use client';

/**
 * Profile sections rendered from real member data only.
 *
 * Every value shown here comes from the member's Collaborate-authored profile or from the
 * consent-filtered AI Tathastu import (TathastuProfileView). Nothing is inferred into a claim:
 *   - achievements/certifications are member-provided claims (the contract carries no verification),
 *   - repository "updated" dates are repository-level and are not presented as the member's commits,
 *   - coding statistics are shown only when AI Tathastu returned them, with their sync time.
 */
import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  Briefcase,
  ExternalLink,
  FileText,
  GraduationCap,
  RefreshCw,
  Star,
  Trophy,
  AlertTriangle,
  Code2,
  Link2,
} from 'lucide-react';
import type { EducationItem, ExperienceItem } from '@/lib/types';

const STALE_AFTER_DAYS = 14;
const TATHASTU_SYNC_URL = '/api/auth/tathastu/start';

export function timeAgoLabel(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const units: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "2024-03" / "2024-03-15" / ISO -> "Mar 2024"; any other text (e.g. "Spring 2023") is shown as given. */
export function formatMonthYear(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/.exec(v);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return v;
}

const CURRENT_PERIOD = /\b(present|current|currently|now|ongoing|pursuing|till date|to date)\b/i;
export const isCurrentPeriod = (period: string | null | undefined) => Boolean(period && CURRENT_PERIOD.test(period));

const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function SectionEmpty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ps-empty">
      <p className="empty-note">{children}</p>
      {action}
    </div>
  );
}

function SyncButton({ label = 'Sync from AI Tathastu' }: { label?: string }) {
  return (
    <button
      type="button"
      className="ps-inline-action"
      onClick={() => {
        window.location.href = TATHASTU_SYNC_URL;
      }}
    >
      <RefreshCw size={13} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  resume: 'resume',
  user_entered: 'entered on AI Tathastu',
  linkedin: 'LinkedIn',
  github: 'GitHub',
};

// ---------------------------------------------------------------------------
// Achievements, certifications and publications
// ---------------------------------------------------------------------------

export interface CredentialItem {
  type: 'achievement' | 'certification' | 'publication';
  title: string;
  issuer: string | null;
  date: string | null;
  url: string | null;
  description?: string | null;
  sources?: string[];
}

const KIND = {
  certification: { label: 'Certifications', cls: 'ps-kind-cert', Icon: Award, link: 'View credential' },
  achievement: { label: 'Achievements', cls: 'ps-kind-award', Icon: Trophy, link: 'View evidence' },
  publication: { label: 'Publications', cls: 'ps-kind-pub', Icon: FileText, link: 'Read publication' },
} as const;

export function CredentialsSection({
  items,
  notShared,
  isSelf,
  name,
  initialLimit,
}: {
  items: CredentialItem[] | null | undefined;
  /** The member linked AI Tathastu but did not share this section. */
  notShared: boolean;
  isSelf: boolean;
  name: string;
  initialLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = items ?? [];
  if (list.length === 0) {
    return (
      <SectionEmpty action={isSelf && notShared ? <SyncButton label="Review sharing in AI Tathastu" /> : undefined}>
        {notShared
          ? isSelf
            ? 'Achievements and certifications are not shared from AI Tathastu.'
            : `${name} has not shared achievements or certifications.`
          : isSelf
            ? 'No achievements or certifications yet. Add them to your AI Tathastu profile and sync.'
            : 'No achievements or certifications listed.'}
      </SectionEmpty>
    );
  }

  const order: CredentialItem['type'][] = ['certification', 'achievement', 'publication'];
  const limit = expanded || !initialLimit ? Infinity : initialLimit;
  let shown = 0;

  return (
    <div className="ps-cred-groups">
      {order.map((type) => {
        const group = list.filter((a) => a.type === type);
        if (!group.length || shown >= limit) return null;
        const visible = group.slice(0, Math.max(0, limit - shown));
        shown += visible.length;
        const k = KIND[type];
        return (
          <section key={type} className="ps-cred-group" aria-label={k.label}>
            <h4 className="ps-group-title">
              {k.label} <span className="ps-count">{group.length}</span>
            </h4>
            <ul className="ps-cred-list">
              {visible.map((a, i) => {
                const meta = [a.issuer, formatMonthYear(a.date)].filter(Boolean);
                const from = (a.sources ?? []).map((s) => SOURCE_LABEL[s] ?? s).filter(Boolean);
                return (
                  <li key={`${type}-${i}-${a.title}`} className={`ps-cred ${k.cls}`}>
                    <span className="ps-cred-icon" aria-hidden="true">
                      <k.Icon size={16} />
                    </span>
                    <div className="ps-cred-body">
                      <div className="ps-cred-title">{a.title}</div>
                      {meta.length > 0 && <div className="ps-cred-meta">{meta.join(' · ')}</div>}
                      {a.description && <p className="ps-cred-desc">{a.description}</p>}
                      <div className="ps-cred-foot">
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="ps-link">
                            <ExternalLink size={12} aria-hidden="true" /> {k.link}
                          </a>
                        )}
                        <span className="ps-provenance" title="AI Tathastu does not verify this entry; it is provided by the member.">
                          Self-reported{from.length ? ` · from ${from.join(', ')}` : ''}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {initialLimit && list.length > initialLimit && (
        <button type="button" className="ps-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

/** "B.Tech, Computer Science" with fieldOfStudy "Computer Science" -> ["B.Tech", "Computer Science"]. */
function splitQualification(e: EducationItem): { qualification: string; field: string | null } {
  const degree = (e.degree || '').trim();
  const field = e.fieldOfStudy?.trim();
  if (field && degree.toLowerCase().endsWith(`, ${field.toLowerCase()}`)) {
    return { qualification: degree.slice(0, degree.length - field.length - 2).trim(), field };
  }
  if (field && degree.toLowerCase() === field.toLowerCase()) return { qualification: '', field };
  return { qualification: degree, field: null };
}

/** A bare number gets a neutral "Grade" label; text such as "CGPA 8.4/10" or "86%" is shown as given. */
function gradeLabel(score: string): string {
  const s = score.trim();
  return /^\d+(\.\d+)?$/.test(s) ? `Grade ${s}` : s;
}

export function EducationSection({
  education,
  notShared,
  isSelf,
  name,
  limit,
}: {
  education: EducationItem[];
  notShared: boolean;
  isSelf: boolean;
  name: string;
  limit?: number;
}) {
  if (education.length === 0) {
    return (
      <SectionEmpty>
        {isSelf
          ? notShared
            ? 'Education is not shared from AI Tathastu. Add it here with Edit Profile, or share it in AI Tathastu.'
            : 'No education listed yet. Use Edit Profile to add it.'
          : `${name} has not shared education details.`}
      </SectionEmpty>
    );
  }

  // Group records by institution for presentation only. Records are never merged or dropped; two
  // records with the same institution and qualification are flagged so the owner can review them.
  const groups: { key: string; institution: string; items: EducationItem[] }[] = [];
  for (const e of education.slice(0, limit ?? education.length)) {
    const key = norm(e.institution) || `__${e.id}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(e);
    else groups.push({ key, institution: e.institution, items: [e] });
  }

  return (
    <ul className="ps-edu-list">
      {groups.map((g) => {
        const seen = new Map<string, number>();
        return (
          <li key={g.key} className="ps-edu">
            <span className="ps-edu-icon" aria-hidden="true">
              <GraduationCap size={20} />
            </span>
            <div className="ps-edu-body">
              <div className="ps-edu-inst">{g.institution || 'Institution not specified'}</div>
              {g.items.map((e) => {
                const { qualification, field } = splitQualification(e);
                const dupKey = `${norm(e.degree)}|${norm(e.period)}`;
                const dupCount = (seen.get(dupKey) ?? 0) + 1;
                seen.set(dupKey, dupCount);
                const current = isCurrentPeriod(e.period);
                return (
                  <div key={e.id} className="ps-edu-entry">
                    {(qualification || field) && (
                      <div className="ps-edu-degree">
                        {qualification}
                        {qualification && field ? ' · ' : ''}
                        {field && <span className="ps-edu-field">{field}</span>}
                      </div>
                    )}
                    <div className="ps-meta-row">
                      {e.period && <span>{e.period}</span>}
                      {current && <span className="ps-chip ps-chip-current">Currently studying</span>}
                      {e.score && <span className="ps-chip ps-chip-grade">{gradeLabel(e.score)}</span>}
                      {e.sourceOrigin === 'tathastu_core' && (
                        <span className="ps-source">{e.locallyEdited ? 'AI Tathastu · edited' : 'AI Tathastu'}</span>
                      )}
                    </div>
                    {isSelf && dupCount > 1 && (
                      <div className="ps-warn" role="note">
                        <AlertTriangle size={12} aria-hidden="true" /> Looks like a duplicate of the entry above. Both are kept; remove one in Edit Profile if it is the same record.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/** A type tag only when the member's own title says so; nothing is assumed to be full-time. */
function roleKind(role: string): string | null {
  if (/\bintern(ship)?\b/i.test(role)) return 'Internship';
  if (/\bco-?founder|\bfounder\b/i.test(role)) return 'Founder';
  if (/\badvis(or|ory|er)\b/i.test(role)) return 'Advisory';
  if (/\bfreelanc/i.test(role)) return 'Freelance';
  if (/\bvolunteer/i.test(role)) return 'Volunteer';
  if (/\bpart[- ]time\b/i.test(role)) return 'Part-time';
  return null;
}

export function ExperienceSection({
  experience,
  notShared,
  isSelf,
  name,
  limit,
}: {
  experience: ExperienceItem[];
  notShared: boolean;
  isSelf: boolean;
  name: string;
  limit?: number;
}) {
  if (experience.length === 0) {
    return (
      <SectionEmpty>
        {isSelf
          ? notShared
            ? 'Experience is not shared from AI Tathastu. Add it here with Edit Profile, or share it in AI Tathastu.'
            : 'No experience listed yet. Use Edit Profile to add roles, internships or projects you led.'
          : `${name} has not shared experience.`}
      </SectionEmpty>
    );
  }
  return (
    <ul className="ps-exp-list">
      {experience.slice(0, limit ?? experience.length).map((exp) => {
        const current = isCurrentPeriod(exp.period);
        const kind = roleKind(exp.role || '');
        const title = exp.role?.trim() || exp.company?.trim() || 'Role not specified';
        const org = exp.role?.trim() ? exp.company?.trim() : '';
        const bullets = (exp.bullets || []).flatMap((b) => b.split(/\n+/)).map((b) => b.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
        return (
          <li key={exp.id} className={`ps-exp ${current ? 'is-current' : ''}`}>
            <span className="ps-exp-icon" aria-hidden="true">
              <Briefcase size={18} />
            </span>
            <div className="ps-exp-body">
              <div className="ps-exp-head">
                <div className="ps-exp-role">{title}</div>
                <div className="ps-exp-chips">
                  {current && <span className="ps-chip ps-chip-current">Current</span>}
                  {kind && <span className="ps-chip">{kind}</span>}
                </div>
              </div>
              {org && <div className="ps-exp-org">{org}</div>}
              <div className="ps-meta-row">
                {exp.period ? <span>{exp.period}</span> : <span className="ps-muted">Dates not specified</span>}
                {exp.sourceOrigin === 'tathastu_core' && <span className="ps-source">{exp.locallyEdited ? 'AI Tathastu · edited' : 'AI Tathastu'}</span>}
              </div>
              {bullets.length === 1 ? (
                <p className="ps-exp-desc">{bullets[0]}</p>
              ) : bullets.length > 1 ? (
                <ul className="ps-exp-bullets">
                  {bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// GitHub activity
// ---------------------------------------------------------------------------

const LANG_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#d4b200',
  python: '#3572a5',
  java: '#b07219',
  go: '#00add8',
  rust: '#b7410e',
  'c++': '#f34b7d',
  c: '#555555',
  'c#': '#178600',
  html: '#e34c26',
  css: '#563d7c',
  'jupyter notebook': '#da5b0b',
  kotlin: '#a97bff',
  swift: '#f05138',
  ruby: '#701516',
  php: '#4f5d95',
  dart: '#00b4ab',
  shell: '#89e051',
};
const langColor = (l: string) => LANG_COLORS[l.toLowerCase()] ?? '#94a3b8';

export function LanguageChip({ name }: { name: string }) {
  return (
    <span className="ps-lang">
      <span className="ps-lang-dot" style={{ background: langColor(name) }} aria-hidden="true" />
      {name}
    </span>
  );
}

type ActivityView = {
  githubRepositories: number;
  connectedSources?: string[];
  recentRepositories?: { name: string; owner: string | null; url: string | null; stars: number | null; languages: string[]; updatedAt: string | null }[];
  profileUpdatedAt?: string | null;
  coding: CodingStat[] | null;
} | null;

type CodingStat = {
  source: 'leetcode' | 'hackerrank';
  solved: { total: number | null; easy: number | null; medium: number | null; hard: number | null };
  contest: { rating: number; attended: number | null; topPercentage: number | null } | null;
  profileUrl?: string | null;
  username?: string | null;
};

export interface TathastuActivityProps {
  /** undefined = not linked to AI Tathastu; null = linked but activity not shared. */
  activity: ActivityView | undefined;
  syncedAt: string | null;
  syncIssue?: { at: string; code: string } | null;
  isSelf: boolean;
  name: string;
}

function SyncStatusBar({ syncedAt, syncIssue, isSelf, source }: { syncedAt: string | null; syncIssue?: { at: string; code: string } | null; isSelf: boolean; source: string }) {
  const stale = syncedAt ? Date.now() - Date.parse(syncedAt) > STALE_AFTER_DAYS * 86400000 : false;
  return (
    <>
      {isSelf && syncIssue && (
        <div className="ps-alert ps-alert-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            Your latest AI Tathastu update ({formatDateTime(syncIssue.at)}) could not be imported, so this shows your previous data. Try syncing again; if it keeps failing, AI Tathastu needs to resend your profile.
          </span>
          <SyncButton label="Retry sync" />
        </div>
      )}
      <div className={`ps-sync ${stale ? 'is-stale' : ''}`}>
        <span title={formatDateTime(syncedAt) ?? undefined}>
          {source} · {syncedAt ? `last synced ${timeAgoLabel(syncedAt)}` : 'not synced yet'}
          {stale ? ' · may be out of date' : ''}
        </span>
        {isSelf && (stale || !syncedAt) && <SyncButton label="Sync now" />}
      </div>
    </>
  );
}

export function GitHubActivitySection({ activity, syncedAt, syncIssue, isSelf, name, repoLimit }: TathastuActivityProps & { repoLimit?: number }) {
  if (activity === undefined) {
    return (
      <SectionEmpty action={isSelf ? <SyncButton label="Connect AI Tathastu" /> : undefined}>
        {isSelf
          ? 'GitHub activity is imported through AI Tathastu. Connect GitHub in AI Tathastu, then sync your profile here.'
          : `${name} has not shared GitHub activity.`}
      </SectionEmpty>
    );
  }
  if (activity === null) {
    return (
      <SectionEmpty action={isSelf ? <SyncButton label="Review sharing in AI Tathastu" /> : undefined}>
        {isSelf ? 'Activity sharing is turned off in AI Tathastu, so GitHub data is not imported.' : `${name} has not shared GitHub activity.`}
      </SectionEmpty>
    );
  }
  const repos = activity.recentRepositories ?? [];
  const githubConnected = (activity.connectedSources ?? []).includes('github') || activity.githubRepositories > 0 || repos.length > 0;
  if (!githubConnected) {
    return (
      <div>
        <SyncStatusBar syncedAt={syncedAt} syncIssue={syncIssue} isSelf={isSelf} source="AI Tathastu" />
        <SectionEmpty action={isSelf ? <SyncButton label="Sync after connecting" /> : undefined}>
          {isSelf
            ? 'GitHub is not connected in AI Tathastu. Connect it under Integrations in AI Tathastu, then sync.'
            : `${name} has not connected GitHub.`}
        </SectionEmpty>
      </div>
    );
  }

  const langCount = new Map<string, number>();
  for (const r of repos) for (const l of r.languages) langCount.set(l, (langCount.get(l) ?? 0) + 1);
  const languages = [...langCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  const latest = repos.map((r) => r.updatedAt).filter(Boolean).sort().pop() ?? null;

  return (
    <div className="ps-gh">
      <SyncStatusBar syncedAt={syncedAt} syncIssue={syncIssue} isSelf={isSelf} source="GitHub via AI Tathastu" />
      <div className="ps-gh-summary">
        <div className="ps-stat">
          <div className="ps-stat-val">{activity.githubRepositories}</div>
          <div className="ps-stat-lbl">Repositories imported</div>
        </div>
        <div className="ps-stat">
          <div className="ps-stat-val">{latest ? timeAgoLabel(latest) : '—'}</div>
          <div className="ps-stat-lbl">Latest repository update</div>
        </div>
        <div className="ps-stat ps-stat-wide">
          <div className="ps-stat-lbl">Languages in recent repositories</div>
          <div className="ps-lang-row">{languages.length ? languages.slice(0, 6).map((l) => <LanguageChip key={l} name={l} />) : <span className="ps-muted">Not reported</span>}</div>
        </div>
      </div>

      {repos.length === 0 ? (
        <p className="empty-note">No recently updated repositories were shared.</p>
      ) : (
        <ul className="ps-repo-list">
          {repos.slice(0, repoLimit ?? repos.length).map((r) => {
            const shortName = r.owner && r.name.startsWith(`${r.owner}/`) ? r.name.slice(r.owner.length + 1) : r.name;
            return (
              <li key={r.name} className="ps-repo">
                <div className="ps-repo-head">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="ps-repo-name">
                      {shortName} <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="ps-repo-name">{shortName}</span>
                  )}
                  {r.owner && <span className="ps-repo-owner">{r.owner}</span>}
                </div>
                <div className="ps-meta-row">
                  {r.languages.slice(0, 4).map((l) => (
                    <LanguageChip key={l} name={l} />
                  ))}
                  {typeof r.stars === 'number' && r.stars > 0 && (
                    <span className="ps-inline-meta">
                      <Star size={12} aria-hidden="true" /> {r.stars}
                    </span>
                  )}
                  {r.updatedAt && <span className="ps-inline-meta" title={formatDateTime(r.updatedAt) ?? undefined}>Updated {timeAgoLabel(r.updatedAt)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="ps-footnote">
        Repository update dates come from GitHub and are not counted as individual contributions. AI Tathastu does not share commit counts, pull requests, issues or a contribution calendar yet.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coding profiles (LeetCode / HackerRank via AI Tathastu)
// ---------------------------------------------------------------------------

const PLATFORM: Record<CodingStat['source'], string> = { leetcode: 'LeetCode', hackerrank: 'HackerRank' };

export function CodingProfilesSection({
  activity,
  syncedAt,
  syncIssue,
  isSelf,
  name,
  linkedProfileUrl,
}: TathastuActivityProps & { linkedProfileUrl?: string | null }) {
  const coding = activity?.coding;
  const linkOnly = linkedProfileUrl ? (
    <a href={linkedProfileUrl} target="_blank" rel="noopener noreferrer" className="ps-link">
      <Link2 size={12} aria-hidden="true" /> Profile link added by {isSelf ? 'you' : name}
    </a>
  ) : null;

  if (!coding || coding.length === 0) {
    const reason =
      activity === undefined
        ? isSelf
          ? 'Coding statistics come from AI Tathastu’s LeetCode connector. Connect AI Tathastu and LeetCode to show them.'
          : `${name} has not shared coding statistics.`
        : activity === null
          ? isSelf
            ? 'Activity sharing is turned off in AI Tathastu, so coding statistics are not imported.'
            : `${name} has not shared coding statistics.`
          : coding === null
            ? isSelf
              ? 'Your last sync came from an AI Tathastu version that did not send coding statistics. Sync again to fetch them.'
              : `${name} has not shared coding statistics.`
            : isSelf
              ? 'LeetCode is not connected in AI Tathastu. Connect it there, then sync to show your solved problems.'
              : `${name} has not connected a coding profile.`;
    return (
      <SectionEmpty action={<div className="ps-actions">{linkOnly}{isSelf && <SyncButton label={activity === undefined ? 'Connect AI Tathastu' : 'Sync now'} />}</div>}>
        {reason}
      </SectionEmpty>
    );
  }

  return (
    <div className="ps-coding">
      <SyncStatusBar syncedAt={syncedAt} syncIssue={syncIssue} isSelf={isSelf} source="Public profile via AI Tathastu" />
      {coding.map((c) => {
        const { easy, medium, hard, total } = c.solved;
        const parts = [
          ['Easy', easy, 'ps-easy'],
          ['Medium', medium, 'ps-medium'],
          ['Hard', hard, 'ps-hard'],
        ] as const;
        const allKnown = easy != null && medium != null && hard != null;
        const sum = allKnown ? easy! + medium! + hard! : 0;
        return (
          <div key={c.source} className="ps-coding-card">
            <div className="ps-coding-head">
              <span className="ps-coding-icon" aria-hidden="true">
                <Code2 size={16} />
              </span>
              <div>
                <div className="ps-coding-platform">{PLATFORM[c.source]}</div>
                {c.profileUrl ? (
                  <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className="ps-link">
                    @{c.username} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  <span className="ps-muted">Profile link not shared</span>
                )}
              </div>
            </div>
            <div className="ps-coding-stats">
              <div className="ps-stat">
                <div className="ps-stat-val">{total ?? '—'}</div>
                <div className="ps-stat-lbl">Problems solved</div>
              </div>
              {c.contest && (
                <div className="ps-stat">
                  <div className="ps-stat-val">{Math.round(c.contest.rating)}</div>
                  <div className="ps-stat-lbl">Contest rating</div>
                </div>
              )}
              {c.contest?.attended != null && (
                <div className="ps-stat">
                  <div className="ps-stat-val">{c.contest.attended}</div>
                  <div className="ps-stat-lbl">Contests attended</div>
                </div>
              )}
              {c.contest?.topPercentage != null && (
                <div className="ps-stat">
                  <div className="ps-stat-val">Top {c.contest.topPercentage}%</div>
                  <div className="ps-stat-lbl">Contest ranking</div>
                </div>
              )}
            </div>
            {parts.some(([, n]) => n != null) && (
              <div className="ps-difficulty">
                {allKnown && sum > 0 && (
                  <div className="ps-diff-bar" role="img" aria-label={`Easy ${easy}, Medium ${medium}, Hard ${hard}`}>
                    {parts.map(([k, n, cls]) => (n ? <span key={k} className={cls} style={{ width: `${(n / sum) * 100}%` }} /> : null))}
                  </div>
                )}
                <div className="ps-diff-legend">
                  {parts.map(([k, n, cls]) => (
                    <span key={k} className="ps-diff-item">
                      <span className={`ps-diff-dot ${cls}`} aria-hidden="true" />
                      {k} <strong>{n ?? '—'}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="ps-footnote">Badges and submission history are not shared by AI Tathastu, so they are not shown.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collaborate-authored activity (kept from the original activity feed)
// ---------------------------------------------------------------------------

export function LocalActivityList({ items }: { items: { id: string; type: string; title: string; timeAgo: string; url?: string; sourceOrigin?: string }[] }) {
  const local = items.filter((a) => a.sourceOrigin !== 'tathastu_core');
  if (!local.length) return null;
  return (
    <ul className="ps-local-activity">
      {local.map((a) => (
        <li key={a.id} className="activity-item">
          <div className="activity-icon">{a.type === 'publication' ? <FileText size={16} /> : <BookOpen size={16} />}</div>
          <div className="activity-title">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</div>
          <div className="activity-time">{a.timeAgo}</div>
        </li>
      ))}
    </ul>
  );
}
