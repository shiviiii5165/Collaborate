'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  MapPin,
  UserPlus,
  MessageSquare,
  MoreHorizontal,
  Folder,
  Code2,
  Trophy,
  GitBranch,
  TrendingUp,
  FileText,
  Edit3,
  ExternalLink,
  Globe,
  Star,
  GitFork,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Check,
  Plus,
  Bookmark,
} from 'lucide-react';

const GithubIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const LinkedinIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);
import { MemberProfile, ProjectItem } from '@/lib/types';
import {
  CredentialsSection,
  EducationSection,
  ExperienceSection,
  GitHubActivitySection,
  CodingProfilesSection,
  LocalActivityList,
} from './ProfileSections';

/**
 * A count is shown only when it is known: imported achievements shared from AI Tathastu (a real
 * zero is then shown as 0), or a counter the member entered themselves. Otherwise '—'.
 */
function knownCount(importedSection: unknown[] | null | undefined, value: number): number | string {
  if (importedSection === null) return '—'; // not shared
  if (Array.isArray(importedSection)) return value;
  return value > 0 ? value : '—';
}

const initial = (s: string) => (s || '?').trim().charAt(0).toUpperCase() || '?';

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

interface ProfileViewProps {
  member: MemberProfile;
  isSelf: boolean;
  connectionStatus?: string;
  onConnect?: () => void;
  onMessage?: () => void;
  onEditProfile?: () => void;
  onOpenFederationSync?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  member,
  isSelf,
  connectionStatus = 'not_connected',
  onConnect,
  onMessage,
  onEditProfile,
  onOpenFederationSync,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'skills' | 'experience' | 'education' | 'achievements' | 'activity'>('overview');
  const [isSaved, setIsSaved] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('auth_success=true')) {
      setSyncStatusText('Synced just now');
      const timer = setTimeout(() => setSyncStatusText(null), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!isSelf && member?.id) {
      fetch('/api/saved')
        .then((r) => r.json())
        .then((data) => {
          if (data.savedMembers) {
            setIsSaved(data.savedMembers.some((sm: any) => sm.id === member.id));
          }
        })
        .catch(() => {});
    }
  }, [member?.id, isSelf]);

  const handleToggleSave = async () => {
    try {
      const res = await fetch('/api/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', targetId: member.id }),
      });
      const data = await res.json();
      if (data.success) {
        setIsSaved(data.isSaved);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const tp = member.tathastuProfile;
  // LeetCode: only from AI Tathastu's LeetCode connector (public profile API), shared under "activity".
  const leetcode = tp?.activity?.coding?.find((c: any) => c.source === 'leetcode') ?? null;
  const leetcodeTitle = leetcode
    ? [
        ['Easy', leetcode.solved.easy],
        ['Medium', leetcode.solved.medium],
        ['Hard', leetcode.solved.hard],
      ]
        .filter(([, n]) => n != null)
        .map(([k, n]) => `${k} ${n}`)
        .join(' · ') + (leetcode.contest ? ` · Contest rating ${Math.round(leetcode.contest.rating)}` : '')
    : !tp
      ? 'Connect LeetCode in AI Tathastu to show your problem-solving activity'
      : tp.activity === null
        ? 'Activity is not shared from AI Tathastu'
        : 'Connect LeetCode in AI Tathastu to show your problem-solving activity';
  const direction = tp?.careerDirection ?? null;
  const achievementsList: any[] = tp?.achievements ?? [];
  const firstName = (member.fullName || '').split(' ')[0] || 'This member';
  // undefined = not linked to AI Tathastu; null = linked, activity not shared.
  const activityView = tp ? tp.activity : undefined;
  const activityProps = {
    activity: activityView,
    syncedAt: tp?.syncedAt ?? null,
    syncIssue: isSelf ? tp?.syncIssue ?? null : null,
    isSelf,
    name: firstName,
  };
  const githubRepos: number | null = tp?.activity ? tp.activity.githubRepositories : null;

  return (
    <div className="profile-card">
      {/* Cover Banner */}
      <div className="cover-banner-wrapper">
        <img
          src={member.bannerUrl || '/images/campus_banner.jpg'}
          alt="Campus Banner"
          className="cover-banner-img"
        />
        <div className="cover-banner-quote">
          &ldquo;You imagine, AI makes it happen.&rdquo;
        </div>
      </div>

      {/* Header Body */}
      <div className="profile-header-body">
        {/* Avatar & Action Row */}
        <div className="profile-avatar-row">
          <div className="avatar-wrapper">
            <img
              src={member.avatarUrl}
              alt={member.fullName}
              className="avatar-img"
            />
            <div className="avatar-online-dot" title="Active on Collaborate" />
          </div>

          <div className="profile-action-btns">
            {isSelf ? (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    window.location.href = '/api/auth/tathastu/start';
                  }}
                  title="Synchronize profile from AI Tathastu"
                >
                  <Sparkles size={16} color="#6366F1" />
                  <span>{syncStatusText || 'AI Tathastu Sync'}</span>
                </button>
                <button className="btn-primary" onClick={onEditProfile}>
                  <Edit3 size={16} />
                  <span>Edit Profile</span>
                </button>
              </>
            ) : (
              <>
                {connectionStatus === 'accepted' ? (
                  <button className="btn-secondary" style={{ color: '#10B981' }}>
                    <Check size={16} />
                    <span>Connected</span>
                  </button>
                ) : connectionStatus === 'request_sent' ? (
                  <button className="btn-secondary" disabled style={{ opacity: 0.7 }}>
                    <span>Request Sent</span>
                  </button>
                ) : (
                  <button className="btn-primary" onClick={onConnect}>
                    <UserPlus size={16} />
                    <span>Connect</span>
                  </button>
                )}

                <button
                  className="btn-secondary"
                  onClick={onMessage}
                  title={
                    connectionStatus === 'accepted'
                      ? 'Open real-time chat'
                      : 'Messaging available after accepted connection'
                  }
                >
                  <MessageSquare size={16} />
                  <span>Message</span>
                </button>

                <button
                  className="btn-secondary"
                  onClick={handleToggleSave}
                  style={{
                    color: isSaved ? '#4F46E5' : '#475569',
                    borderColor: isSaved ? '#C7D2FE' : '#E2E8F0',
                    background: isSaved ? '#EEF2FF' : '#FFFFFF',
                  }}
                  title={isSaved ? 'Remove from saved' : 'Save profile bookmark'}
                >
                  <Bookmark size={16} fill={isSaved ? '#4F46E5' : 'none'} />
                  <span>{isSaved ? 'Saved' : 'Save'}</span>
                </button>

                <button className="btn-icon-more" title="More options">
                  <MoreHorizontal size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Identity Details */}
        <div className="profile-name-row">
          <h1 className="profile-full-name">{member.fullName}</h1>
          {member.isVerified && (
            <span
              className="verified-badge-icon"
              title={`Verified by Tathastu Admin: ${member.verifiedCategory || 'Identity'}`}
            >
              <CheckCircle2 size={20} fill="#0284C7" color="#ffffff" />
            </span>
          )}
          {member.plan === 'premium' && (
            <span className="premium-badge-tag">Premium</span>
          )}
        </div>

        <div className="profile-headline">{member.headline}</div>

        {/* Badges Pill Row */}
        <div className="badges-row">
          {member.statusBadges.map((badge, idx) => {
            const isStudent = badge.toLowerCase().includes('student');
            const isGoal = badge.toLowerCase().includes('goal');
            const isIntern = badge.toLowerCase().includes('intern') || badge.toLowerCase().includes('open');
            const className = isStudent
              ? 'badge-student'
              : isGoal
              ? 'badge-goal'
              : isIntern
              ? 'badge-internship'
              : 'badge-goal';

            return (
              <span key={idx} className={`pill-badge ${className}`}>
                {badge}
              </span>
            );
          })}

          {member.location && (
            <span className="badge-location">
              <MapPin size={14} />
              <span>{member.location}</span>
            </span>
          )}
        </div>

        {/* Key Metrics Row */}
        <div className="metrics-row">
          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#EFF6FF', color: '#2563EB' }}>
              <Folder size={18} />
            </div>
            <div>
              <div
                className="metric-val"
                title={member.tathastuProfile?.projects === null ? 'Not shared from AI Tathastu' : undefined}
              >
                {member.tathastuProfile?.projects === null ? '—' : member.metrics.projects}
              </div>
              <div className="metric-lbl">Projects</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FAF5FF', color: '#9333EA' }}>
              <Code2 size={18} />
            </div>
            <div>
              <div
                className="metric-val"
                title={member.tathastuProfile?.skills === null ? 'Not shared from AI Tathastu' : undefined}
              >
                {member.tathastuProfile?.skills === null ? '—' : member.metrics.skills}
              </div>
              <div className="metric-lbl">Skills</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FEFCE8', color: '#CA8A04' }}>
              <Trophy size={18} />
            </div>
            <div>
              <div className="metric-val" title={tp?.achievements === null ? 'Not shared from AI Tathastu' : undefined}>
                {knownCount(tp?.achievements, member.metrics.achievements)}
              </div>
              <div className="metric-lbl">Achievements</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#F1F5F9', color: '#0F172A' }}>
              <GitBranch size={18} />
            </div>
            <div>
              {/* Repositories imported through AI Tathastu's GitHub connector. Not a contribution
                  count: AI Tathastu does not share commit totals, so none is shown. */}
              <div
                className="metric-val"
                title={githubRepos == null ? (tp ? 'Activity is not shared from AI Tathastu' : 'GitHub is not connected through AI Tathastu') : 'Repositories imported from GitHub via AI Tathastu'}
              >
                {githubRepos ?? '—'}
              </div>
              <div className="metric-lbl">GitHub Repos</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#ECFDF5', color: '#059669' }}>
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="metric-val" title={leetcodeTitle}>
                {leetcode?.solved.total != null ? leetcode.solved.total : '—'}
              </div>
              <div className="metric-lbl">LeetCode Solved</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FDF2F8', color: '#DB2777' }}>
              <FileText size={18} />
            </div>
            <div>
              <div className="metric-val" title={tp?.achievements === null ? 'Not shared from AI Tathastu' : undefined}>
                {knownCount(tp?.achievements, member.metrics.publications)}
              </div>
              <div className="metric-lbl">Publications</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Row */}
      <div className="profile-tabs-bar">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Sparkles size={16} />
          <span>Overview</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          <Folder size={16} />
          <span>Projects</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          <Code2 size={16} />
          <span>Skills</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'experience' ? 'active' : ''}`}
          onClick={() => setActiveTab('experience')}
        >
          <span>Experience</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'education' ? 'active' : ''}`}
          onClick={() => setActiveTab('education')}
        >
          <span>Education</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'achievements' ? 'active' : ''}`}
          onClick={() => setActiveTab('achievements')}
        >
          <Trophy size={16} />
          <span>Achievements</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          <span>Activity</span>
        </button>
      </div>

      {/* Tabs Content */}
      <div style={{ padding: '24px 28px' }}>
        {activeTab === 'overview' && (
          <div className="tab-content-grid">
            {/* About Card */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">About</div>
                {isSelf && (
                  <button className="info-card-action" onClick={onEditProfile}>
                    <Edit3 size={14} style={{ display: 'inline', marginRight: 4 }} />
                    Edit
                  </button>
                )}
              </div>
              {member.about?.trim() ? (
                <p className="about-text">{member.about}</p>
              ) : isSelf ? (
                <div>
                  <p className="empty-note">Add an About section so people know what you work on and what you are looking for.</p>
                  <button className="empty-note-action" onClick={onEditProfile}>Add an About section</button>
                </div>
              ) : (
                <p className="empty-note">{member.fullName} has not added an About section yet.</p>
              )}

              {/* Context Tags */}
              <div className="context-meta-list">
                {member.contextTags.map((tag, i) => (
                  <div key={i} className="context-meta-item">
                    <CheckCircle2 size={14} color="#6366F1" />
                    <span>{tag}</span>
                  </div>
                ))}
              </div>

              {/* Social Links */}
              <div className="social-links-row">
                {member.socialLinks.github && (
                  <a
                    href={member.socialLinks.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="social-link-btn"
                  >
                    <GithubIcon size={16} />
                    <span>GitHub</span>
                  </a>
                )}
                {member.socialLinks.linkedin && (
                  <a
                    href={member.socialLinks.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="social-link-btn"
                  >
                    <LinkedinIcon size={16} />
                    <span>LinkedIn</span>
                  </a>
                )}
                {member.socialLinks.leetcode && (
                  <a
                    href={member.socialLinks.leetcode}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="social-link-btn"
                  >
                    <Code2 size={16} />
                    <span>LeetCode</span>
                  </a>
                )}
                {member.socialLinks.portfolio && (
                  <a
                    href={member.socialLinks.portfolio}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="social-link-btn"
                  >
                    <Globe size={16} />
                    <span>Portfolio</span>
                  </a>
                )}
              </div>
            </div>

            {/* Career direction (replaces the old score-based "AI Tathastu Insights" card).
                Only fields AI Tathastu's v3 engine supports and the member shared: the canonical
                role label, skills assessed Proficient/Advanced, and (owner only) the top open
                competencies. No scores, percentages or raw role ids. Hidden when nothing is shared. */}
            {direction && (
              <div className="info-card">
                <div className="info-card-header">
                  <div className="info-card-title">Career direction</div>
                </div>
                <div className="direction-label">{direction.label}</div>

                {direction.strengths.length > 0 && (
                  <>
                    <div className="direction-sub">Demonstrated strengths</div>
                    <div className="skills-tags-wrap">
                      {direction.strengths.map((s: string) => (
                        <span key={s} className="skill-tag-pill">{s}</span>
                      ))}
                    </div>
                  </>
                )}

                {isSelf && direction.developmentAreas && direction.developmentAreas.length > 0 && (
                  <>
                    <div className="direction-sub">Working on (visible only to you)</div>
                    <div className="skills-tags-wrap">
                      {direction.developmentAreas.map((s: string) => (
                        <span key={s} className="skill-tag-pill" style={{ background: '#F8FAFC', color: '#475569' }}>{s}</span>
                      ))}
                    </div>
                  </>
                )}

                {isSelf && !direction.assessed && (
                  <p className="empty-note" style={{ marginTop: 8 }}>
                    AI Tathastu does not have enough evidence to assess this direction yet.
                  </p>
                )}

                <div className="direction-meta">
                  From AI Tathastu
                  {formatDate(direction.assessedAt) ? ` · assessed ${formatDate(direction.assessedAt)}` : ''}
                </div>
              </div>
            )}

            {/* Achievements, certifications and publications shared from AI Tathastu */}
            {(achievementsList.length > 0 || isSelf) && (
              <div className="info-card">
                <div className="info-card-header">
                  <div className="info-card-title">Achievements &amp; certifications</div>
                  {achievementsList.length > 4 && (
                    <button className="info-card-action" onClick={() => setActiveTab('achievements')}>
                      View all
                    </button>
                  )}
                </div>
                <CredentialsSection items={achievementsList} notShared={tp?.achievements === null} isSelf={isSelf} name={firstName} initialLimit={4} />
              </div>
            )}

            {/* Skills Card */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Skills</div>
                <button
                  className="info-card-action"
                  onClick={() => setActiveTab('skills')}
                >
                  View all
                </button>
              </div>
              <div className="skills-tags-wrap">
                {member.skills.slice(0, 14).map((skill, i) => {
                  const verifiedItem = (member.tathastuProfile?.skills?.items as any[])?.find(
                    (it: any) => (it.name || it).toLowerCase() === skill.toLowerCase() && it.verified
                  );
                  return (
                    <span
                      key={i}
                      className={`skill-tag-pill ${
                        ['GenAI', 'RAG', 'LangChain', 'Pinecone'].includes(skill)
                          ? 'special'
                          : ''
                      }`}
                    >
                      {skill}
                      {verifiedItem && (
                        <span title="Verified Skill from AI Tathastu" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
                          <CheckCircle2
                            size={12}
                            color="#10B981"
                          />
                        </span>
                      )}
                    </span>
                  );
                })}
                {member.skills.length > 14 && (
                  <span
                    className="skill-tag-pill"
                    style={{ background: '#F1F5F9', color: '#64748B', cursor: 'pointer' }}
                    onClick={() => setActiveTab('skills')}
                  >
                    + {member.skills.length - 14} more
                  </span>
                )}
              </div>
            </div>

            {/* Top Projects Card */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Top Projects</div>
                <button
                  className="info-card-action"
                  onClick={() => setActiveTab('projects')}
                >
                  View all
                </button>
              </div>

              {!member.projects[0] && (
                <p className="empty-note">{isSelf ? 'No projects yet. Add one, or share projects from AI Tathastu.' : 'No projects shared yet.'}</p>
              )}
              {member.projects[0] && (
                <div className="project-card-item">
                  {member.projects[0].imageUrl && (
                    <img
                      src={member.projects[0].imageUrl}
                      alt={member.projects[0].title}
                      className="project-thumb"
                    />
                  )}
                  <div className="project-details">
                    <div>
                      <div className="project-title-row">
                        <span className="project-title">{member.projects[0].title}</span>
                        {member.projects[0].featured && (
                          <span className="featured-badge">Featured</span>
                        )}
                      </div>
                      <p className="project-desc">{member.projects[0].description}</p>
                      <div className="project-tags-row">
                        {member.projects[0].tags.map((t, idx) => (
                          <span key={idx} className="project-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="project-stats-row">
                      <div className="project-meta-icons">
                        {typeof member.projects[0].stars === 'number' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Star size={14} color="#F59E0B" /> {member.projects[0].stars}
                          </span>
                        )}
                        {typeof member.projects[0].forks === 'number' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <GitFork size={14} color="#64748B" /> {member.projects[0].forks}
                          </span>
                        )}
                      </div>
                      {member.projects[0].demoUrl && (
                        <a
                          href={member.projects[0].demoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="live-demo-btn"
                        >
                          <ExternalLink size={14} />
                          <span>Live Demo</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Experience Card */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Experience</div>
                <button
                  className="info-card-action"
                  onClick={() => setActiveTab('experience')}
                >
                  View all
                </button>
              </div>

              <ExperienceSection experience={member.experience} notShared={tp?.experience === null} isSelf={isSelf} name={firstName} limit={3} />
              {member.experience.length > 3 && (
                <button className="ps-more" onClick={() => setActiveTab('experience')}>
                  Show all {member.experience.length} roles
                </button>
              )}
            </div>

            {/* Education Card */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Education</div>
                {isSelf && (
                  <button className="info-card-action" onClick={onEditProfile}>
                    <Edit3 size={14} style={{ display: 'inline', marginRight: 4 }} />
                    Edit
                  </button>
                )}
              </div>

              <EducationSection education={member.education} notShared={tp?.education === null} isSelf={isSelf} name={firstName} />
            </div>

            {/* GitHub activity (via AI Tathastu) */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">GitHub activity</div>
                <button className="info-card-action" onClick={() => setActiveTab('activity')}>
                  View all
                </button>
              </div>
              <GitHubActivitySection {...activityProps} repoLimit={3} />
            </div>

            {/* Coding profiles (via AI Tathastu) */}
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Coding profiles</div>
              </div>
              <CodingProfilesSection {...activityProps} linkedProfileUrl={member.socialLinks?.leetcode || null} />
            </div>
          </div>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                All Projects ({member.projects.length})
              </h3>
              {isSelf && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={onEditProfile}
                >
                  <Plus size={14} /> Add / Manage Projects
                </button>
              )}
            </div>
            {member.projects.length === 0 ? (
              <div className="info-card" style={{ textAlign: 'center', padding: '32px 20px', color: '#64748B' }}>
                <Folder size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <div>No projects published yet.</div>
                {isSelf && (
                  <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                    <Plus size={14} /> Add Your First Project
                  </button>
                )}
              </div>
            ) : (
              member.projects.map((proj) => (
                <div key={proj.id} className="project-card-item">
                  {proj.imageUrl && (
                    <img src={proj.imageUrl} alt={proj.title} className="project-thumb" />
                  )}
                  <div className="project-details">
                    <div>
                      <div className="project-title-row">
                        <span className="project-title">{proj.title}</span>
                        {proj.featured && <span className="featured-badge">Featured</span>}
                      </div>
                      <p className="project-desc">{proj.description}</p>
                      <div className="project-tags-row">
                        {proj.tags.map((t, idx) => (
                          <span key={idx} className="project-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="project-stats-row">
                      <div className="project-meta-icons">
                        {typeof proj.stars === 'number' && <span>⭐ {proj.stars}</span>}
                        {typeof proj.forks === 'number' && <span>🔱 {proj.forks}</span>}
                        {proj.sourceOrigin === 'tathastu_core' && (
                          <span title={proj.locallyEdited ? 'Imported from AI Tathastu, edited in Collaborate' : 'Imported from AI Tathastu'}>
                            {proj.locallyEdited ? 'AI Tathastu · edited' : 'AI Tathastu'}
                          </span>
                        )}
                      </div>
                      {proj.demoUrl && (
                        <a
                          href={proj.demoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="live-demo-btn"
                        >
                          <ExternalLink size={14} />
                          <span>Live Demo</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Skills Tab */}
        {activeTab === 'skills' && (
          <div className="info-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Skills ({member.skills.length})
              </h3>
              {isSelf && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={onEditProfile}
                >
                  <Plus size={14} /> Manage Skills
                </button>
              )}
            </div>
            {member.skills.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 20px', color: '#64748B' }}>
                <div>No skills added yet.</div>
                {isSelf && (
                  <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                    <Plus size={14} /> Add Technical Skills
                  </button>
                )}
              </div>
            ) : (
              <div className="skills-tags-wrap">
                {member.skills.map((skill, i) => (
                  <span key={i} className="skill-tag-pill special" style={{ padding: '8px 18px' }}>
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Experience Tab */}
        {activeTab === 'experience' && (
          <div className="info-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Professional Experience ({member.experience.length})
              </h3>
              {isSelf && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={onEditProfile}
                >
                  <Plus size={14} /> Manage Experience
                </button>
              )}
            </div>
            <ExperienceSection experience={member.experience} notShared={tp?.experience === null} isSelf={isSelf} name={firstName} />
            {isSelf && member.experience.length === 0 && (
              <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                <Plus size={14} /> Add Experience
              </button>
            )}
          </div>
        )}

        {/* Education Tab */}
        {activeTab === 'education' && (
          <div className="info-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
                Academic Background ({member.education.length})
              </h3>
              {isSelf && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={onEditProfile}
                >
                  <Plus size={14} /> Manage Education
                </button>
              )}
            </div>
            <EducationSection education={member.education} notShared={tp?.education === null} isSelf={isSelf} name={firstName} />
            {isSelf && member.education.length === 0 && (
              <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                <Plus size={14} /> Add Education
              </button>
            )}
          </div>
        )}

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <div className="info-card">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 16px' }}>
              Achievements, certifications &amp; publications ({achievementsList.length})
            </h3>
            <CredentialsSection items={achievementsList} notShared={tp?.achievements === null} isSelf={isSelf} name={firstName} />
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">GitHub activity</div>
              </div>
              <GitHubActivitySection {...activityProps} />
            </div>
            <div className="info-card">
              <div className="info-card-header">
                <div className="info-card-title">Coding profiles</div>
              </div>
              <CodingProfilesSection {...activityProps} linkedProfileUrl={member.socialLinks?.leetcode || null} />
            </div>
            {member.recentActivity.some((a) => a.sourceOrigin !== 'tathastu_core') && (
              <div className="info-card">
                <div className="info-card-header">
                  <div className="info-card-title">Activity on Collaborate</div>
                </div>
                <LocalActivityList items={member.recentActivity} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
