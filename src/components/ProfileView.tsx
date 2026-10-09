'use client';

import React, { useState } from 'react';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'skills' | 'experience' | 'education' | 'activity'>('overview');

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
                <button className="btn-secondary" onClick={onOpenFederationSync}>
                  <Sparkles size={16} color="#6366F1" />
                  <span>AI Tathastu Sync</span>
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
              <div className="metric-val">{member.metrics.projects}</div>
              <div className="metric-lbl">Projects</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FAF5FF', color: '#9333EA' }}>
              <Code2 size={18} />
            </div>
            <div>
              <div className="metric-val">{member.metrics.skills}</div>
              <div className="metric-lbl">Skills</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FEFCE8', color: '#CA8A04' }}>
              <Trophy size={18} />
            </div>
            <div>
              <div className="metric-val">{member.metrics.achievements}</div>
              <div className="metric-lbl">Achievements</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#F1F5F9', color: '#0F172A' }}>
              <GitBranch size={18} />
            </div>
            <div>
              <div className="metric-val">{member.metrics.githubContributions}</div>
              <div className="metric-lbl">GitHub Contributions</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#ECFDF5', color: '#059669' }}>
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="metric-val">{member.metrics.leetcodeProblems}</div>
              <div className="metric-lbl">LeetCode Problems</div>
            </div>
          </div>

          <div className="metric-item">
            <div className="metric-icon-box" style={{ background: '#FDF2F8', color: '#DB2777' }}>
              <FileText size={18} />
            </div>
            <div>
              <div className="metric-val">{member.metrics.publications}</div>
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
              <p className="about-text">{member.about}</p>

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

            {/* AI Tathastu Insights Card */}
            <div className="insights-card">
              <div className="info-card-header" style={{ marginBottom: 6 }}>
                <div className="info-card-title" style={{ color: '#4338CA' }}>
                  <Sparkles size={18} color="#7C3AED" />
                  <span>AI Tathastu Insights</span>
                </div>
                <a
                  href="#insights"
                  className="info-card-action"
                  style={{ color: '#6D28D9' }}
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Full AI Tathastu Career & Competency Matrix verified.');
                  }}
                >
                  View Full Analysis →
                </a>
              </div>

              <div className="insights-content">
                <img
                  src="/images/eora_avatar.jpg"
                  alt="EORA AI Guide"
                  className="insights-avatar"
                />
                <div className="insights-bubble">
                  You have strong project work in Generative AI and RAG. Your next step could be
                  improving evaluation and deployment evidence to align with your{' '}
                  <strong>GenAI Engineer</strong> goal.
                </div>
              </div>

              <div className="insights-actions-row">
                <button
                  className="btn-insight"
                  onClick={() => alert('Opening project evaluation benchmark template...')}
                >
                  Improve Project
                </button>
                <button
                  className="btn-insight"
                  onClick={() => alert('Matching open research tracks and internships...')}
                >
                  Explore Opportunities
                </button>
                <button
                  className="btn-insight"
                  onClick={() => alert('GenAI Engineer Roadmap: Milestone 3 of 5 completed.')}
                >
                  View Roadmap
                </button>
              </div>
            </div>

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
                {member.skills.slice(0, 14).map((skill, i) => (
                  <span
                    key={i}
                    className={`skill-tag-pill ${
                      ['GenAI', 'RAG', 'LangChain', 'Pinecone'].includes(skill)
                        ? 'special'
                        : ''
                    }`}
                  >
                    {skill}
                  </span>
                ))}
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Star size={14} color="#F59E0B" /> {member.projects[0].stars || 112}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <GitFork size={14} color="#64748B" /> {member.projects[0].forks || 28}
                        </span>
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

              {member.experience.map((exp) => (
                <div key={exp.id} className="timeline-item">
                  <div className="timeline-logo-box">A</div>
                  <div className="timeline-body">
                    <div className="timeline-role">{exp.role}</div>
                    <div className="timeline-company">{exp.company}</div>
                    <div className="timeline-period">{exp.period}</div>
                    <ul className="timeline-bullets">
                      {exp.bullets.map((b, bi) => (
                        <li key={bi}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
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

              {member.education.map((edu) => (
                <div key={edu.id} className="timeline-item">
                  <div
                    className="timeline-logo-box"
                    style={{ background: '#FFF7ED', color: '#EA580C' }}
                  >
                    🎓
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-role">{edu.institution}</div>
                    <div className="timeline-period">{edu.period}</div>
                    <div className="timeline-company">{edu.degree}</div>
                    <div
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: '#059669',
                        marginTop: 4,
                      }}
                    >
                      {edu.score}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent Activity Card */}
            <div className="info-card grid-col-full">
              <div className="info-card-header">
                <div className="info-card-title">Recent Activity</div>
                <button
                  className="info-card-action"
                  onClick={() => setActiveTab('activity')}
                >
                  View all
                </button>
              </div>

              {member.recentActivity.map((act) => (
                <div key={act.id} className="activity-item">
                  <div className="activity-icon">
                    {act.type === 'github' && <GithubIcon size={18} />}
                    {act.type === 'leetcode' && <TrendingUp size={18} color="#10B981" />}
                    {act.type === 'project' && <Folder size={18} color="#6366F1" />}
                    {act.type === 'publication' && <FileText size={18} color="#EC4899" />}
                  </div>
                  <div className="activity-title">{act.title}</div>
                  <div className="activity-time">{act.timeAgo}</div>
                </div>
              ))}
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
                        <span>⭐ {proj.stars || 50}</span>
                        <span>🔱 {proj.forks || 12}</span>
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
                Verified Skills & Specializations ({member.skills.length})
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
            {member.experience.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 20px', color: '#64748B' }}>
                <div>No experience records listed yet.</div>
                {isSelf && (
                  <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                    <Plus size={14} /> Add Experience
                  </button>
                )}
              </div>
            ) : (
              member.experience.map((exp) => (
                <div key={exp.id} className="timeline-item" style={{ marginBottom: 24 }}>
                  <div className="timeline-logo-box">EXP</div>
                  <div className="timeline-body">
                    <div className="timeline-role">{exp.role}</div>
                    <div className="timeline-company">{exp.company}</div>
                    <div className="timeline-period">{exp.period}</div>
                    <ul className="timeline-bullets">
                      {exp.bullets.map((b, bi) => (
                        <li key={bi}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))
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
            {member.education.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 20px', color: '#64748B' }}>
                <div>No academic records listed yet.</div>
                {isSelf && (
                  <button className="btn-primary" style={{ marginTop: 12, padding: '8px 16px', fontSize: '0.84rem' }} onClick={onEditProfile}>
                    <Plus size={14} /> Add Education
                  </button>
                )}
              </div>
            ) : (
              member.education.map((edu) => (
                <div key={edu.id} className="timeline-item">
                  <div className="timeline-logo-box">EDU</div>
                  <div className="timeline-body">
                    <div className="timeline-role">{edu.institution}</div>
                    <div className="timeline-period">{edu.period}</div>
                    <div className="timeline-company">{edu.degree}</div>
                    <div style={{ color: '#059669', fontWeight: 600, marginTop: 4 }}>
                      {edu.score}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="info-card">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 16 }}>
              Activity Feed & Contributions
            </h3>
            {member.recentActivity.map((act) => (
              <div key={act.id} className="activity-item">
                <div className="activity-icon">
                  {act.type === 'github' && <GithubIcon size={18} />}
                  {act.type === 'leetcode' && <TrendingUp size={18} color="#10B981" />}
                  {act.type === 'project' && <Folder size={18} color="#6366F1" />}
                  {act.type === 'publication' && <FileText size={18} color="#EC4899" />}
                </div>
                <div className="activity-title">{act.title}</div>
                <div className="activity-time">{act.timeAgo}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
