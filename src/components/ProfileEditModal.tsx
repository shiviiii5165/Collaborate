'use client';

import React, { useState } from 'react';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { MemberProfile } from '@/lib/types';

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
  const [headline, setHeadline] = useState(currentUser.headline);
  const [about, setAbout] = useState(currentUser.about);
  const [location, setLocation] = useState(currentUser.location);
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '/images/rahul_avatar.jpg');
  const [bannerUrl, setBannerUrl] = useState(currentUser.bannerUrl || '/images/campus_banner.jpg');
  const [skills, setSkills] = useState<string[]>([...currentUser.skills]);
  const [newSkill, setNewSkill] = useState('');
  const [statusBadges, setStatusBadges] = useState<string[]>([...currentUser.statusBadges]);
  const [newBadge, setNewBadge] = useState('');
  const [collaborationInterests, setCollaborationInterests] = useState<string[]>([
    ...(currentUser.collaborationInterests || []),
  ]);
  const [newInterest, setNewInterest] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'connections_only' | 'private'>(
    currentUser.profileVisibility || 'public'
  );
  const [contactVisibility, setContactVisibility] = useState<'connections_only' | 'hidden'>(
    currentUser.contactVisibility || 'connections_only'
  );
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill('');
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillToRemove));
  };

  const handleAddBadge = () => {
    if (newBadge.trim() && !statusBadges.includes(newBadge.trim())) {
      setStatusBadges([...statusBadges, newBadge.trim()]);
      setNewBadge('');
    }
  };

  const handleRemoveBadge = (badgeToRemove: string) => {
    setStatusBadges(statusBadges.filter((b) => b !== badgeToRemove));
  };

  const handleAddInterest = () => {
    if (newInterest.trim() && !collaborationInterests.includes(newInterest.trim())) {
      setCollaborationInterests([...collaborationInterests, newInterest.trim()]);
      setNewInterest('');
    }
  };

  const handleRemoveInterest = (interestToRemove: string) => {
    setCollaborationInterests(collaborationInterests.filter((i) => i !== interestToRemove));
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
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSaveSuccess(data.member);
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit Professional Profile</h3>
          <button onClick={onClose} style={{ color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Professional Headline */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Professional Headline
            </label>
            <input
              type="text"
              style={{
                width: '100%',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: '0.88rem',
              }}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          {/* About / Bio */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              About Summary
            </label>
            <textarea
              rows={4}
              style={{
                width: '100%',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: '0.88rem',
                resize: 'vertical',
              }}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
          </div>

          {/* Location */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Broad Location
            </label>
            <input
              type="text"
              style={{
                width: '100%',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: '0.88rem',
              }}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          {/* Status Badges */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Status Badges (Pills)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {statusBadges.map((badge, idx) => (
                <span
                  key={idx}
                  className="pill-badge badge-goal"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {badge}
                  <button onClick={() => handleRemoveBadge(badge)} style={{ color: '#EF4444' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Add badge (e.g. 'Open to internships')"
                style={{
                  flex: 1,
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                }}
                value={newBadge}
                onChange={(e) => setNewBadge(e.target.value)}
              />
              <button className="btn-secondary" onClick={handleAddBadge}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* Skills */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Skills & Specializations
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {skills.map((skill, idx) => (
                <span
                  key={idx}
                  className="skill-tag-pill special"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {skill}
                  <button onClick={() => handleRemoveSkill(skill)} style={{ color: '#EF4444' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Add technical skill (e.g. 'PyTorch')"
                style={{
                  flex: 1,
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                }}
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
              />
              <button className="btn-secondary" onClick={handleAddSkill}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* Avatar and Cover Banner */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                Profile Photo / Avatar
              </label>
              <select
                style={{
                  width: '100%',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: '0.88rem',
                }}
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
                Cover Banner
              </label>
              <select
                style={{
                  width: '100%',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: '0.88rem',
                }}
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
              >
                <option value="/images/campus_banner.jpg">Campus Twilight Banner</option>
                <option value="/images/tathastu_robot.jpg">AI Tathastu Robot Banner</option>
              </select>
            </div>
          </div>

          {/* Collaboration Interests */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Collaboration Interests
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {collaborationInterests.map((interest, idx) => (
                <span
                  key={idx}
                  className="pill-badge badge-goal"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {interest}
                  <button onClick={() => handleRemoveInterest(interest)} style={{ color: '#EF4444' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Add collaboration interest (e.g. 'Open-source GenAI')"
                style={{
                  flex: 1,
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                }}
                value={newInterest}
                onChange={(e) => setNewInterest(e.target.value)}
              />
              <button className="btn-secondary" onClick={handleAddInterest}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>

          {/* Profile Visibility & Contact Visibility */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                Profile Visibility
              </label>
              <select
                style={{
                  width: '100%',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: '0.88rem',
                }}
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
                style={{
                  width: '100%',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: '0.88rem',
                }}
                value={contactVisibility}
                onChange={(e: any) => setContactVisibility(e.target.value)}
              >
                <option value="connections_only">Connections Only</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={loading}>
            <Save size={14} />
            <span>{loading ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
