'use client';

import React, { useState } from 'react';
import {
  X,
  Save,
  Plus,
  Trash2,
  Folder,
  GraduationCap,
  Briefcase,
  Globe,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { MemberProfile, ProjectItem, EducationItem, ExperienceItem, SocialLinks } from '@/lib/types';

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: MemberProfile;
  onSaveSuccess: (updated: MemberProfile) => void;
}

export const ProfileEditModal: React.FC<ProfileEditModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSaveSuccess,
}) => {
  const [modalTab, setModalTab] = useState<'basic' | 'skills' | 'projects' | 'education' | 'experience' | 'links'>('basic');

  // Basic info
  const [headline, setHeadline] = useState(currentUser.headline);
  const [about, setAbout] = useState(currentUser.about);
  const [location, setLocation] = useState(currentUser.location);
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '/images/rahul_avatar.jpg');
  const [bannerUrl, setBannerUrl] = useState(currentUser.bannerUrl || '/images/campus_banner.jpg');
  const [visibility, setVisibility] = useState<'public' | 'connections_only' | 'private'>(
    currentUser.profileVisibility || 'public'
  );
  const [contactVisibility, setContactVisibility] = useState<'connections_only' | 'hidden'>(
    currentUser.contactVisibility || 'connections_only'
  );

  // Status Badges
  const [statusBadges, setStatusBadges] = useState<string[]>([...currentUser.statusBadges]);
  const [newBadge, setNewBadge] = useState('');

  // Skills
  const [skills, setSkills] = useState<string[]>([...currentUser.skills]);
  const [newSkill, setNewSkill] = useState('');

  // Interests
  const [collaborationInterests, setCollaborationInterests] = useState<string[]>([
    ...(currentUser.collaborationInterests || []),
  ]);
  const [newInterest, setNewInterest] = useState('');

  // Projects CRUD
  const [projects, setProjects] = useState<ProjectItem[]>([...currentUser.projects]);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjTags, setNewProjTags] = useState('');
  const [newProjDemoUrl, setNewProjDemoUrl] = useState('');
  const [newProjFeatured, setNewProjFeatured] = useState(false);

  // Education CRUD
  const [education, setEducation] = useState<EducationItem[]>([...currentUser.education]);
  const [newEduInstitution, setNewEduInstitution] = useState('');
  const [newEduDegree, setNewEduDegree] = useState('');
  const [newEduPeriod, setNewEduPeriod] = useState('');
  const [newEduScore, setNewEduScore] = useState('');

  // Experience CRUD
  const [experience, setExperience] = useState<ExperienceItem[]>([...currentUser.experience]);
  const [newExpRole, setNewExpRole] = useState('');
  const [newExpCompany, setNewExpCompany] = useState('');
  const [newExpPeriod, setNewExpPeriod] = useState('');
  const [newExpBullets, setNewExpBullets] = useState('');

  // Social Links
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({ ...currentUser.socialLinks });

  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // Skill Handlers
  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill('');
    }
  };
  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillToRemove));
  };

  // Badge Handlers
  const handleAddBadge = () => {
    if (newBadge.trim() && !statusBadges.includes(newBadge.trim())) {
      setStatusBadges([...statusBadges, newBadge.trim()]);
      setNewBadge('');
    }
  };
  const handleRemoveBadge = (badgeToRemove: string) => {
    setStatusBadges(statusBadges.filter((b) => b !== badgeToRemove));
  };

  // Interest Handlers
  const handleAddInterest = () => {
    if (newInterest.trim() && !collaborationInterests.includes(newInterest.trim())) {
      setCollaborationInterests([...collaborationInterests, newInterest.trim()]);
      setNewInterest('');
    }
  };
  const handleRemoveInterest = (interestToRemove: string) => {
    setCollaborationInterests(collaborationInterests.filter((i) => i !== interestToRemove));
  };

  // Project CRUD Handlers
  const handleAddProject = () => {
    if (!newProjTitle.trim()) return;
    const tagsArray = newProjTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const newProj: ProjectItem = {
      id: `proj_${Date.now()}`,
      title: newProjTitle.trim(),
      description: newProjDesc.trim() || 'A high-impact engineering project.',
      tags: tagsArray.length > 0 ? tagsArray : ['Engineering', 'AI'],
      demoUrl: newProjDemoUrl.trim() || undefined,
      featured: newProjFeatured,
      stars: 12,
      forks: 3,
      sourceOrigin: 'collaborate',
    };
    setProjects([newProj, ...projects]);
    setNewProjTitle('');
    setNewProjDesc('');
    setNewProjTags('');
    setNewProjDemoUrl('');
    setNewProjFeatured(false);
  };
  const handleRemoveProject = (projId: string) => {
    setProjects(projects.filter((p) => p.id !== projId));
  };

  // Education CRUD Handlers
  const handleAddEducation = () => {
    if (!newEduInstitution.trim()) return;
    const newEdu: EducationItem = {
      id: `edu_${Date.now()}`,
      institution: newEduInstitution.trim(),
      degree: newEduDegree.trim() || 'Bachelor of Technology in Computer Science',
      period: newEduPeriod.trim() || '2023 – 2027',
      score: newEduScore.trim() || 'CGPA: 8.5 / 10',
    };
    setEducation([newEdu, ...education]);
    setNewEduInstitution('');
    setNewEduDegree('');
    setNewEduPeriod('');
    setNewEduScore('');
  };
  const handleRemoveEducation = (eduId: string) => {
    setEducation(education.filter((e) => e.id !== eduId));
  };

  // Experience CRUD Handlers
  const handleAddExperience = () => {
    if (!newExpRole.trim()) return;
    const bullets = newExpBullets
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);
    const newExp: ExperienceItem = {
      id: `exp_${Date.now()}`,
      role: newExpRole.trim(),
      company: newExpCompany.trim() || 'AI Tathastu Engineering Lab',
      period: newExpPeriod.trim() || '2025 – Present',
      bullets: bullets.length > 0 ? bullets : ['Collaborated on distributed AI training workflows.'],
    };
    setExperience([newExp, ...experience]);
    setNewExpRole('');
    setNewExpCompany('');
    setNewExpPeriod('');
    setNewExpBullets('');
  };
  const handleRemoveExperience = (expId: string) => {
    setExperience(experience.filter((e) => e.id !== expId));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentUser.id,
          updates: {
            headline,
            about,
            location,
            avatarUrl,
            bannerUrl,
            skills,
            statusBadges,
            collaborationInterests,
            profileVisibility: visibility,
            contactVisibility,
            projects,
            education,
            experience,
            socialLinks,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSaveSuccess(data.member);
        onClose();
      } else {
        alert(data.error || 'Failed to update profile');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: 740, width: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" style={{ fontSize: '1.15rem', fontWeight: 800 }}>
              Edit Professional Profile
            </h3>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Update your headline, projects, skills, education, and credentials.
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#94A3B8', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Modal Sub-Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 24px',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            overflowX: 'auto',
          }}
        >
          {[
            { id: 'basic', label: 'Basic Info', icon: Sparkles },
            { id: 'skills', label: 'Skills & Interests', icon: Globe },
            { id: 'projects', label: `Projects (${projects.length})`, icon: Folder },
            { id: 'education', label: `Education (${education.length})`, icon: GraduationCap },
            { id: 'experience', label: `Experience (${experience.length})`, icon: Briefcase },
            { id: 'links', label: 'Social & Links', icon: ExternalLink },
          ].map((t) => {
            const Icon = t.icon;
            const active = modalTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setModalTab(t.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: active ? '#EEF2FF' : 'transparent',
                  color: active ? '#4F46E5' : '#64748B',
                }}
              >
                <Icon size={14} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* TAB 1: BASIC INFO */}
          {modalTab === 'basic' && (
            <>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Professional Headline
                </label>
                <input
                  type="text"
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  About Summary (Biography)
                </label>
                <textarea
                  rows={4}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem', resize: 'vertical' }}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Location
                </label>
                <input
                  type="text"
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Profile Photo / Avatar
                  </label>
                  <select
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                  >
                    <option value="/images/rahul_avatar.jpg">Default Avatar (Rahul)</option>
                    <option value="/images/priya_avatar.jpg">Professional Avatar (Priya)</option>
                    <option value="/images/aman_avatar.jpg">Engineering Avatar (Aman)</option>
                    <option value="/images/neha_avatar.jpg">Architect Avatar (Neha)</option>
                    <option value="/images/eora_guide.jpg">Faculty Avatar (Dr. Vikram)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Cover Artwork
                  </label>
                  <select
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                    value={bannerUrl}
                    onChange={(e) => setBannerUrl(e.target.value)}
                  >
                    <option value="/images/campus_banner.jpg">Twilight Campus Artwork</option>
                    <option value="/images/tathastu_robot.jpg">AI Tathastu Robot Artwork</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Status Badges (Pills)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {statusBadges.map((badge, idx) => (
                    <span key={idx} className="pill-badge badge-goal" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {badge}
                      <button onClick={() => handleRemoveBadge(badge)} style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Add badge (e.g. 'Open to internships')"
                    style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 8, padding: '7px 12px', fontSize: '0.82rem' }}
                    value={newBadge}
                    onChange={(e) => setNewBadge(e.target.value)}
                  />
                  <button type="button" className="btn-secondary" onClick={handleAddBadge}>
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Profile Visibility
                  </label>
                  <select
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                    value={visibility}
                    onChange={(e: any) => setVisibility(e.target.value)}
                  >
                    <option value="public">Public (Discoverable across Collaborate network)</option>
                    <option value="connections_only">Connections Only (Only accepted connections)</option>
                    <option value="private">Private (Hidden from search directory)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    Contact Visibility
                  </label>
                  <select
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                    value={contactVisibility}
                    onChange={(e: any) => setContactVisibility(e.target.value)}
                  >
                    <option value="connections_only">Connections Only</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: SKILLS & INTERESTS */}
          {modalTab === 'skills' && (
            <>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Technical Skills & Competencies ({skills.length})
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {skills.map((skill, idx) => (
                    <span key={idx} className="skill-tag-pill special" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {skill}
                      <button onClick={() => handleRemoveSkill(skill)} style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Add technical skill (e.g. 'PyTorch', 'Next.js', 'Vector DBs')"
                    style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 8, padding: '7px 12px', fontSize: '0.82rem' }}
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                  />
                  <button type="button" className="btn-secondary" onClick={handleAddSkill}>
                    <Plus size={14} /> Add Skill
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Collaboration Interests
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {collaborationInterests.map((interest, idx) => (
                    <span key={idx} className="pill-badge badge-goal" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {interest}
                      <button onClick={() => handleRemoveInterest(interest)} style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Add collaboration interest (e.g. 'Open-source GenAI', 'Hackathon Teams')"
                    style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 8, padding: '7px 12px', fontSize: '0.82rem' }}
                    value={newInterest}
                    onChange={(e) => setNewInterest(e.target.value)}
                  />
                  <button type="button" className="btn-secondary" onClick={handleAddInterest}>
                    <Plus size={14} /> Add Interest
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: PROJECTS CRUD */}
          {modalTab === 'projects' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <label style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>
                  Portfolio Projects ({projects.length})
                </label>
              </div>

              {/* Add New Project Card */}
              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#4F46E5', marginBottom: 10 }}>
                  + Add New Project
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="text"
                    placeholder="Project Title (e.g. 'MedVision-ViT' or 'ChatSQL')"
                    value={newProjTitle}
                    onChange={(e) => setNewProjTitle(e.target.value)}
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                  />
                  <textarea
                    rows={2}
                    placeholder="Project Description (highlights, architecture, outcomes)"
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem', resize: 'vertical' }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <input
                      type="text"
                      placeholder="Tags comma-separated (e.g. 'PyTorch, Vision, Transformers')"
                      value={newProjTags}
                      onChange={(e) => setNewProjTags(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                    <input
                      type="url"
                      placeholder="Demo URL (https://...)"
                      value={newProjDemoUrl}
                      onChange={(e) => setNewProjDemoUrl(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#475569', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={newProjFeatured}
                        onChange={(e) => setNewProjFeatured(e.target.checked)}
                      />
                      Mark as Featured Project
                    </label>
                    <button type="button" className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={handleAddProject}>
                      <Plus size={13} /> Add to Projects
                    </button>
                  </div>
                </div>
              </div>

              {/* Project Items List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {projects.map((proj) => (
                  <div
                    key={proj.id}
                    style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {proj.title}
                        {proj.featured && (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#FEF3C7', color: '#D97706', borderRadius: 4, fontWeight: 700 }}>
                            Featured
                          </span>
                        )}
                        {proj.sourceOrigin === 'tathastu_core' && (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#EEF2FF', color: '#4F46E5', borderRadius: 4 }}>
                            Tathastu Verified
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>{proj.description}</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                        {proj.tags.map((t, idx) => (
                          <span key={idx} style={{ fontSize: '0.72rem', background: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: 4 }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveProject(proj.id)}
                      style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
                      title="Delete Project"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: EDUCATION CRUD */}
          {modalTab === 'education' && (
            <div>
              <label style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', display: 'block', marginBottom: 12 }}>
                Education Records ({education.length})
              </label>

              {/* Add Education Box */}
              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#4F46E5', marginBottom: 10 }}>
                  + Add Education Record
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="text"
                    placeholder="Institution (e.g. 'Lovely Professional University')"
                    value={newEduInstitution}
                    onChange={(e) => setNewEduInstitution(e.target.value)}
                    style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <input
                      type="text"
                      placeholder="Degree (e.g. 'B.Tech in Computer Science & Engineering')"
                      value={newEduDegree}
                      onChange={(e) => setNewEduDegree(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                    <input
                      type="text"
                      placeholder="Period (e.g. '2023 – 2027')"
                      value={newEduPeriod}
                      onChange={(e) => setNewEduPeriod(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Score (e.g. 'CGPA: 8.9 / 10')"
                      value={newEduScore}
                      onChange={(e) => setNewEduScore(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem', maxWidth: 240 }}
                    />
                    <button type="button" className="btn-primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={handleAddEducation}>
                      <Plus size={13} /> Add Record
                    </button>
                  </div>
                </div>
              </div>

              {/* Education List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {education.map((edu) => (
                  <div
                    key={edu.id}
                    style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                        {edu.institution}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                        {edu.degree} • {edu.period}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>
                        {edu.score}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveEducation(edu.id)}
                      style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: EXPERIENCE CRUD */}
          {modalTab === 'experience' && (
            <div>
              <label style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', display: 'block', marginBottom: 12 }}>
                Work & Research Experience ({experience.length})
              </label>

              {/* Add Experience Box */}
              <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#4F46E5', marginBottom: 10 }}>
                  + Add Experience Record
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input
                      type="text"
                      placeholder="Role (e.g. 'AI Engineering Intern')"
                      value={newExpRole}
                      onChange={(e) => setNewExpRole(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                    <input
                      type="text"
                      placeholder="Company / Lab (e.g. 'Tathastu AI Labs')"
                      value={newExpCompany}
                      onChange={(e) => setNewExpCompany(e.target.value)}
                      style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Period (e.g. 'May 2025 – Present')"
                    value={newExpPeriod}
                    onChange={(e) => setNewExpPeriod(e.target.value)}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem' }}
                  />
                  <textarea
                    rows={2}
                    placeholder="Key highlights (each on a new line)"
                    value={newExpBullets}
                    onChange={(e) => setNewExpBullets(e.target.value)}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 12px', fontSize: '0.84rem', resize: 'vertical' }}
                  />
                  <button type="button" className="btn-primary" style={{ alignSelf: 'flex-end', padding: '6px 14px', fontSize: '0.8rem' }} onClick={handleAddExperience}>
                    <Plus size={13} /> Add Experience
                  </button>
                </div>
              </div>

              {/* Experience List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {experience.map((exp) => (
                  <div
                    key={exp.id}
                    style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                        {exp.role} @ {exp.company}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{exp.period}</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: '#475569' }}>
                        {exp.bullets.map((b, bi) => (
                          <li key={bi}>{b}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveExperience(exp.id)}
                      style={{ color: '#EF4444', border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: SOCIAL & PORTFOLIO LINKS */}
          {modalTab === 'links' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  GitHub Profile URL
                </label>
                <input
                  type="url"
                  placeholder="https://github.com/username"
                  value={socialLinks.github || ''}
                  onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  LinkedIn Profile URL
                </label>
                <input
                  type="url"
                  placeholder="https://linkedin.com/in/username"
                  value={socialLinks.linkedin || ''}
                  onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  LeetCode / HackerRank Profile URL
                </label>
                <input
                  type="url"
                  placeholder="https://leetcode.com/username"
                  value={socialLinks.leetcode || ''}
                  onChange={(e) => setSocialLinks({ ...socialLinks, leetcode: e.target.value })}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                  Personal Portfolio Website
                </label>
                <input
                  type="url"
                  placeholder="https://yourname.dev"
                  value={socialLinks.portfolio || ''}
                  onChange={(e) => setSocialLinks({ ...socialLinks, portfolio: e.target.value })}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem' }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid #E2E8F0', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={loading}>
            <Save size={14} />
            <span>{loading ? 'Saving Changes...' : 'Save Profile Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
