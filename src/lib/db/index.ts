import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  MemberProfile,
  ConnectionRecord,
  DirectMessage,
  Conversation,
  VerificationRequest,
  VerificationAuditLog,
  AbuseReport,
  ProfileViewLedgerEntry,
} from '@/lib/types';
import { assertDatabaseAvailable, isNeonConfigured, getNeonPool } from './neon';
import { MembersRepository } from './repositories/members';
import { ConnectionsRepository } from './repositories/connections';
import { MessagesRepository } from './repositories/messages';
import { QuotaRepository } from './repositories/quota';
import { VerificationRepository } from './repositories/verification';
import { NotificationsRepository } from './repositories/notifications';

export function getKolkataDateKey(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export interface ExternalIdentityMapping {
  id: string;
  memberId: string;
  provider: 'aitathastu_oidc' | 'google';
  externalSubjectId: string;
  externalEmail: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  recipientId: string;
  actorId?: string;
  type: 'connection_request' | 'connection_accepted' | 'message' | 'verification_approved' | 'system';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

interface DatabaseState {
  members: Record<string, MemberProfile>;
  credentials: Record<string, { passwordHash: string; salt: string }>;
  identityMappings: Record<string, ExternalIdentityMapping>;
  connections: Record<string, ConnectionRecord>;
  conversations: Record<string, Conversation>;
  messages: DirectMessage[];
  verificationRequests: Record<string, VerificationRequest>;
  verificationAuditLogs: VerificationAuditLog[];
  abuseReports: Record<string, AbuseReport>;
  profileViewLedger: ProfileViewLedgerEntry[];
  blockedUsers: string[]; // "blockerId:blockedId"
  notifications: AppNotification[];
  savedMembers?: Record<string, string[]>; // "userId -> [savedMemberId1, ...]"
  webhookEvents?: Record<string, { provider: string; eventId: string; eventType: string; processedAt: string }>;
}

// COLLABORATE_DATA_FILE lets automated tests use an isolated store instead of the tracked
// data/collaborate.db.json. Default path is unchanged.
const DATA_FILE_PATH = process.env.COLLABORATE_DATA_FILE
  ? path.resolve(process.env.COLLABORATE_DATA_FILE)
  : path.join(process.cwd(), 'data', 'collaborate.db.json');

class DurableCollaborateDatabase {
  private state: DatabaseState;
  private isPersisting = false;

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      assertDatabaseAvailable();
    }
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): DatabaseState {
    try {
      if (fs.existsSync(DATA_FILE_PATH)) {
        const raw = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.members && Object.keys(parsed.members).length > 0) {
          if (!parsed.savedMembers) parsed.savedMembers = {};
          if (!parsed.webhookEvents) parsed.webhookEvents = {};
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Could not read existing database file, falling back to seed', err);
    }

    return this.createInitialSeed();
  }

  private persistToDisk(): void {
    if (this.isPersisting) return;
    this.isPersisting = true;
    try {
      const dir = path.dirname(DATA_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${DATA_FILE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
      try {
        fs.renameSync(tmpPath, DATA_FILE_PATH);
      } catch {
        fs.copyFileSync(tmpPath, DATA_FILE_PATH);
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    } catch (err) {
      console.error('Failed to persist database state to disk', err);
    } finally {
      this.isPersisting = false;
    }
  }

  private createInitialSeed(): DatabaseState {
    const rahul: MemberProfile = {
      id: 'usr_rahul',
      email: 'rahulsharma@gmail.com',
      fullName: 'Rahul Sharma',
      headline: 'AI/ML Builder | GenAI Enthusiast | Final Year CSE @ LPU',
      avatarUrl: '/images/rahul_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: true,
      verifiedCategory: 'institution',
      verifiedAt: '2026-08-15T10:00:00Z',
      plan: 'free',
      statusBadges: ['Student', 'GenAI Engineer (Goal)', 'Open to internships'],
      location: 'Phagwara, Punjab, India',
      about:
        'Final year Computer Science student passionate about building real-world AI/ML applications. I love working on Generative AI, RAG systems, and practical ML solutions that create impact. Always eager to learn, collaborate, and contribute to meaningful projects.',
      contextTags: ['LPU', 'rahulsharma.dev', 'rahulsharma@gmail.com'],
      socialLinks: {
        github: 'https://github.com/rahulsharma-ai',
        linkedin: 'https://linkedin.com/in/rahulsharma-ai',
        leetcode: 'https://leetcode.com/rahulsharma_dev',
        portfolio: 'https://rahulsharma.dev',
      },
      metrics: {
        projects: 12,
        skills: 28,
        achievements: 4,
        githubContributions: '320+',
        leetcodeProblems: '850+',
        publications: 2,
      },
      skills: [
        'Python',
        'Machine Learning',
        'Deep Learning',
        'GenAI',
        'RAG',
        'LangChain',
        'Pinecone',
        'FastAPI',
        'React',
        'Docker',
        'AWS',
        'PostgreSQL',
        'Git',
        'PyTorch',
        'Transformers',
        'Vector DBs',
        'Next.js',
        'TypeScript',
      ],
      projects: [
        {
          id: 'proj_1',
          title: 'Tathastu AI Assistant',
          featured: true,
          description:
            'A RAG-based AI assistant for students with multi-source document understanding.',
          tags: ['Python', 'RAG', 'OpenAI', 'FastAPI'],
          stars: 112,
          forks: 28,
          demoUrl: 'https://tathastu-assistant.demo.aitathastu.com',
          imageUrl: '/images/tathastu_robot.jpg',
          sourceOrigin: 'collaborate',
        },
        {
          id: 'proj_2',
          title: 'Autonomous Code Review Agent',
          featured: false,
          description:
            'Multi-agent review system using AST parsing and LLM feedback to detect security vulnerabilities.',
          tags: ['TypeScript', 'LangChain', 'Next.js'],
          stars: 45,
          forks: 12,
          demoUrl: 'https://codereview-agent.demo.app',
          sourceOrigin: 'tathastu_core',
        },
      ],
      experience: [
        {
          id: 'exp_1',
          role: 'AI/ML Research Intern',
          company: 'Tathastu Labs (Remote)',
          period: 'Jun 2024 – Aug 2024',
          bullets: [
            'Worked on RAG-based academic assistant.',
            'Built data pipeline and evaluation framework.',
            'Deployed prototype using FastAPI and Docker.',
          ],
        },
      ],
      education: [
        {
          id: 'edu_1',
          institution: 'Lovely Professional University (LPU)',
          period: '2021 – 2025 (Expected)',
          degree: 'B.Tech in Computer Science and Engineering',
          score: 'CGPA: 8.4 / 10',
        },
      ],
      recentActivity: [
        {
          id: 'act_1',
          type: 'github',
          title: 'Pushed new commit to tathastu-ai',
          timeAgo: '2 hours ago',
        },
        {
          id: 'act_2',
          type: 'leetcode',
          title: 'Solved a LeetCode problem (Hard)',
          timeAgo: '5 hours ago',
        },
        {
          id: 'act_3',
          type: 'project',
          title: 'Updated project: RAG Chatbot',
          timeAgo: 'yesterday',
        },
      ],
      aiSpecializations: ['Generative AI', 'Retrieval-Augmented Generation', 'LLM Agent Architectures'],
      collaborationInterests: [
        'Open-source AI tooling',
        'Model evaluation pipelines',
        'Research paper implementations',
      ],
      discoverable: true,
      profileVisibility: 'public',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: {
        autoSyncProjects: true,
        autoSyncSkills: true,
        autoSyncAchievements: true,
      },
      isDemo: true,
      role: 'member',
    };

    const priya: MemberProfile = {
      id: 'usr_priya',
      email: 'priya.mehta@iiitd.ac.in',
      fullName: 'Priya Mehta',
      headline: 'AI Researcher @ IIITD | Computer Vision & Medical Diagnostics',
      avatarUrl: '/images/priya_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: true,
      verifiedCategory: 'institution',
      verifiedAt: '2026-07-10T12:00:00Z',
      plan: 'free',
      statusBadges: ['Researcher', 'PhD Scholar', 'Vision Transformers'],
      location: 'New Delhi, India',
      about:
        'Doctoral researcher at IIIT Delhi specializing in self-supervised computer vision models and federated medical diagnostics.',
      contextTags: ['IIITD', 'priyamehta.ai', 'priya.mehta@iiitd.ac.in'],
      socialLinks: {
        github: 'https://github.com/priyamehta-vision',
        linkedin: 'https://linkedin.com/in/priyamehta-ai',
      },
      metrics: {
        projects: 8,
        skills: 24,
        achievements: 6,
        githubContributions: '410+',
        leetcodeProblems: '340+',
        publications: 5,
      },
      skills: ['PyTorch', 'Computer Vision', 'Vision Transformers', 'Medical Imaging', 'Python'],
      projects: [],
      experience: [],
      education: [
        {
          id: 'edu_p1',
          institution: 'Indraprastha Institute of Information Technology Delhi (IIITD)',
          period: '2023 – 2027',
          degree: 'Ph.D. in Computer Science',
          score: 'CGPA: 9.2 / 10',
        },
      ],
      recentActivity: [],
      aiSpecializations: ['Computer Vision', 'Medical Diagnostics'],
      collaborationInterests: ['Model-evaluation collaborations', 'Clinical dataset curation'],
      discoverable: true,
      profileVisibility: 'public',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: { autoSyncProjects: true, autoSyncSkills: true, autoSyncAchievements: true },
      isDemo: true,
      role: 'member',
    };

    const aman: MemberProfile = {
      id: 'usr_aman',
      email: 'aman.verma@google.com',
      fullName: 'Aman Verma',
      headline: 'ML Engineer @ Google | Distributed Systems & Ray Architecture',
      avatarUrl: '/images/aman_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: true,
      verifiedCategory: 'organization',
      verifiedAt: '2026-06-20T11:00:00Z',
      plan: 'premium',
      statusBadges: ['Google', 'ML Infrastructure', 'Distributed Training'],
      location: 'Bengaluru, Karnataka, India',
      about: 'Building high-scale distributed training orchestration and GPU cluster optimization pipelines.',
      contextTags: ['Google', 'IIT Bombay'],
      socialLinks: {},
      metrics: { projects: 15, skills: 35, achievements: 9, githubContributions: '650+', leetcodeProblems: '920+', publications: 3 },
      skills: ['Distributed Systems', 'Ray', 'CUDA', 'TensorRT', 'Kubernetes', 'Python'],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: ['Distributed ML Systems', 'Inference Acceleration'],
      collaborationInterests: ['Open source distributed training', 'Mentoring young engineers'],
      discoverable: true,
      profileVisibility: 'public',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: { autoSyncProjects: true, autoSyncSkills: true, autoSyncAchievements: true },
      isDemo: true,
      role: 'member',
    };

    const neha: MemberProfile = {
      id: 'usr_neha',
      email: 'neha.kapoor@lpu.in',
      fullName: 'Neha Kapoor',
      headline: 'GenAI Builder | LPU | LangChain & Vector Systems Specialist',
      avatarUrl: '/images/neha_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: false,
      plan: 'free',
      statusBadges: ['Student', 'GenAI Builder', 'Open to collaborations'],
      location: 'Phagwara, Punjab, India',
      about: 'Building next-gen conversational workflows, agentic memory networks, and multi-tenant RAG systems.',
      contextTags: ['LPU', 'neha.dev'],
      socialLinks: {},
      metrics: { projects: 9, skills: 22, achievements: 3, githubContributions: '280+', leetcodeProblems: '510+', publications: 1 },
      skills: ['LangChain', 'FastAPI', 'Pinecone', 'Next.js', 'Python', 'Vector DBs', 'RAG'],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: ['Agentic RAG', 'Hybrid Search', 'Vector Embeddings'],
      collaborationInterests: ['GenAI hackathons', 'RAG evaluation frameworks'],
      discoverable: true,
      profileVisibility: 'public',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: { autoSyncProjects: true, autoSyncSkills: true, autoSyncAchievements: true },
      isDemo: true,
      role: 'member',
    };

    const admin: MemberProfile = {
      id: 'usr_admin',
      email: 'admin@aitathastu.com',
      fullName: 'Tathastu Trust & Safety Admin',
      headline: 'Platform Verification & Moderation Authority @ Tathastu Collaborate',
      avatarUrl: '/images/rahul_avatar.jpg',
      bannerUrl: '/images/campus_banner.jpg',
      isVerified: true,
      verifiedCategory: 'organization',
      plan: 'premium',
      statusBadges: ['Platform Admin', 'Trust & Safety', 'Audit Reviewer'],
      location: 'New Delhi, India',
      about: 'Authorized safety and credential verification administrator for Tathastu Collaborate.',
      contextTags: ['Tathastu Ops', 'Security Admin'],
      socialLinks: {},
      metrics: { projects: 0, skills: 10, achievements: 0, githubContributions: '0', leetcodeProblems: '0', publications: 0 },
      skills: ['Moderation', 'Audit Compliance', 'OIDC Federation'],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: ['Security', 'Identity'],
      collaborationInterests: [],
      discoverable: false,
      profileVisibility: 'private',
      contactVisibility: 'hidden',
      isLinkedWithTathastu: true,
      tathastuSyncStatus: 'synced',
      tathastuSyncSettings: { autoSyncProjects: false, autoSyncSkills: false, autoSyncAchievements: false },
      role: 'admin',
    };

    const initial: DatabaseState = {
      members: {
        [rahul.id]: rahul,
        [priya.id]: priya,
        [aman.id]: aman,
        [neha.id]: neha,
        [admin.id]: admin,
      },
      credentials: {},
      identityMappings: {},
      connections: {
        conn_rahul_priya: {
          id: 'conn_rahul_priya',
          requesterId: 'usr_priya',
          recipientId: 'usr_rahul',
          status: 'accepted',
          introMessage: 'Hi Rahul, I noticed your RAG assistant project and would love to connect!',
          createdAt: '2026-09-15T10:00:00Z',
          updatedAt: '2026-09-15T12:30:00Z',
        },
      },
      conversations: {
        conv_rahul_priya: {
          id: 'conv_rahul_priya',
          participantIds: ['usr_rahul', 'usr_priya'],
          lastMessage: {
            content: 'I would love to run a test on your benchmark datasets this weekend!',
            timestamp: '2026-10-09T14:15:00Z',
            senderId: 'usr_priya',
          },
          unreadCounts: { usr_rahul: 1, usr_priya: 0 },
          updatedAt: '2026-10-09T14:15:00Z',
        },
      },
      messages: [
        {
          id: 'msg_1',
          conversationId: 'conv_rahul_priya',
          senderId: 'usr_priya',
          recipientId: 'usr_rahul',
          content: 'Hi Rahul! Congratulations on the Tathastu AI Assistant project!',
          timestamp: '2026-10-09T14:00:00Z',
          status: 'read',
        },
        {
          id: 'msg_2',
          conversationId: 'conv_rahul_priya',
          senderId: 'usr_rahul',
          recipientId: 'usr_priya',
          content: 'Thanks Priya! Your recent CVPR workshop paper on MedVision looked super inspiring.',
          timestamp: '2026-10-09T14:05:00Z',
          status: 'read',
        },
        {
          id: 'msg_3',
          conversationId: 'conv_rahul_priya',
          senderId: 'usr_priya',
          recipientId: 'usr_rahul',
          content: 'I would love to run a test on your benchmark datasets this weekend!',
          timestamp: '2026-10-09T14:15:00Z',
          status: 'delivered',
        },
      ],
      verificationRequests: {
        vreq_neha: {
          id: 'vreq_neha',
          memberId: 'usr_neha',
          memberName: 'Neha Kapoor',
          memberEmail: 'neha.kapoor@lpu.in',
          category: 'institution',
          evidenceSummary:
            'Official LPU student registration card (Registration ID: 12108745) valid through June 2026.',
          status: 'pending',
          createdAt: '2026-10-08T09:30:00Z',
        },
      },
      verificationAuditLogs: [],
      abuseReports: {},
      profileViewLedger: [],
      blockedUsers: [],
      notifications: [
        {
          id: 'notif_1',
          recipientId: 'usr_rahul',
          actorId: 'usr_priya',
          type: 'message',
          title: 'New message from Priya Mehta',
          body: 'I would love to run a test on your benchmark datasets this weekend!',
          isRead: false,
          createdAt: '2026-10-09T14:15:00Z',
        },
      ],
      savedMembers: {},
      webhookEvents: {},
    };

    const dir = path.dirname(DATA_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(initial, null, 2), 'utf-8');

    return initial;
  }

  // --- Map-like Compatibility Getters for legacy callers ---
  public get members() {
    return {
      get: (id: string): MemberProfile | undefined => this.getMemberById(id) || undefined,
      values: (): MemberProfile[] => this.getAllMembers(),
      entries: (): [string, MemberProfile][] => Object.entries(this.state.members),
    };
  }

  public get connections() {
    return {
      get: (id: string): ConnectionRecord | undefined => this.state.connections[id] || undefined,
      values: (): ConnectionRecord[] => this.getAllConnections(),
      entries: (): [string, ConnectionRecord][] => Object.entries(this.state.connections),
    };
  }

  public get conversations() {
    return {
      get: (id: string): Conversation | undefined => this.getConversationById(id) || undefined,
      values: (): Conversation[] => this.getAllConversations(),
      entries: (): [string, Conversation][] => Object.entries(this.state.conversations),
    };
  }

  public get messages(): DirectMessage[] {
    return this.state.messages;
  }

  public get verificationRequests() {
    return {
      get: (id: string): VerificationRequest | undefined =>
        this.state.verificationRequests[id] || undefined,
      values: (): VerificationRequest[] => this.getAllVerificationRequests(),
    };
  }

  public get verificationAuditLogs(): VerificationAuditLog[] {
    return this.state.verificationAuditLogs;
  }

  // --- Members ---
  public getMemberById(id: string): MemberProfile | null {
    return this.state.members[id] || null;
  }

  public getMemberByEmail(email: string): MemberProfile | null {
    const cleanEmail = email.toLowerCase().trim();
    for (const m of Object.values(this.state.members)) {
      if (m.email.toLowerCase() === cleanEmail) return m;
    }
    return null;
  }

  public getMemberByTathastuUserId(tathastuUserId: string): MemberProfile | null {
    if (!tathastuUserId) return null;
    for (const m of Object.values(this.state.members)) {
      if (m.tathastu_user_id === tathastuUserId) return m;
    }
    const mapping = this.getMappingByExternalSub('aitathastu_oidc', tathastuUserId);
    if (mapping) {
      return this.getMemberById(mapping.memberId);
    }
    return null;
  }

  public saveMember(member: MemberProfile): void {
    this.state.members[member.id] = member;
    this.persistToDisk();
    if (isNeonConfigured()) {
      MembersRepository.saveMember(member).catch((err) => {
        console.error('Failed to sync member to PostgreSQL:', err);
      });
    }
  }

  public async saveMemberAsync(member: MemberProfile): Promise<void> {
    this.state.members[member.id] = member;
    this.persistToDisk();
    if (isNeonConfigured()) {
      await MembersRepository.saveMember(member);
    }
  }

  public getAllMembers(): MemberProfile[] {
    return Object.values(this.state.members);
  }

  // --- Password Credentials ---
  public setCredential(userId: string, hash: string, salt: string): void {
    this.state.credentials[userId] = { passwordHash: hash, salt };
    this.persistToDisk();
  }

  public getCredential(userId: string): { passwordHash: string; salt: string } | null {
    return this.state.credentials[userId] || null;
  }

  // --- External Identity Mapping (OIDC / SSO) ---
  public getMappingByExternalSub(
    provider: 'aitathastu_oidc' | 'google',
    externalSub: string
  ): ExternalIdentityMapping | null {
    for (const m of Object.values(this.state.identityMappings)) {
      if (m.provider === provider && m.externalSubjectId === externalSub) return m;
    }
    return null;
  }

  public getMappingByMemberId(
    provider: 'aitathastu_oidc' | 'google',
    memberId: string
  ): ExternalIdentityMapping | null {
    for (const m of Object.values(this.state.identityMappings)) {
      if (m.provider === provider && m.memberId === memberId) return m;
    }
    return null;
  }

  public setMapping(mapping: ExternalIdentityMapping): void {
    this.state.identityMappings[mapping.id] = mapping;
    this.persistToDisk();
  }

  public removeMapping(mappingId: string): void {
    delete this.state.identityMappings[mappingId];
    this.persistToDisk();
  }

  // --- Webhook Events (Durable Idempotency & Replay Protection) ---
  public async isWebhookProcessedAsync(provider: string, eventId: string): Promise<boolean> {
    if (isNeonConfigured()) {
      try {
        const pool = getNeonPool();
        if (pool) {
          const res = await pool.query(
            'SELECT id FROM webhook_events WHERE provider = $1 AND event_id = $2',
            [provider, eventId]
          );
          if (res.rows && res.rows.length > 0) return true;
        }
      } catch (err) {
        console.warn('[DurableDB] Postgres webhook query failed, checking local state:', err);
      }
    }
    return this.isWebhookProcessed(provider, eventId);
  }

  public isWebhookProcessed(provider: string, eventId: string): boolean {
    if (!this.state.webhookEvents) this.state.webhookEvents = {};
    const key = `${provider}:${eventId}`;
    return Boolean(this.state.webhookEvents[key]);
  }

  public async recordWebhookEventAsync(
    provider: string,
    eventId: string,
    eventType: string = 'webhook',
    payload: any = {}
  ): Promise<void> {
    this.recordWebhookEvent(provider, eventId, eventType);

    if (isNeonConfigured()) {
      try {
        const pool = getNeonPool();
        if (pool) {
          const hookId = `wh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await pool.query(
            `INSERT INTO webhook_events (id, provider, event_id, event_type, payload, processed_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (provider, event_id) DO NOTHING`,
            [hookId, provider, eventId, eventType, JSON.stringify(payload)]
          );
        }
      } catch (err) {
        console.warn('[DurableDB] Postgres webhook record failed:', err);
      }
    }
  }

  /**
   * Atomically claims a webhook event ID. Returns true exactly once per (provider, eventId).
   * - Postgres: INSERT ... ON CONFLICT DO NOTHING RETURNING relies on UNIQUE(provider, event_id),
   *   so concurrent deliveries across instances cannot both win. DB errors propagate
   *   (callers must fail closed).
   * - Local store: synchronous check-and-set (atomic within this single-threaded process).
   */
  public async claimWebhookEventAsync(
    provider: string,
    eventId: string,
    eventType: string = 'webhook',
    payload: any = {}
  ): Promise<boolean> {
    if (isNeonConfigured()) {
      const pool = getNeonPool();
      if (!pool) throw new Error('WEBHOOK_STORE_UNAVAILABLE');
      const hookId = `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const res = await pool.query(
        `INSERT INTO webhook_events (id, provider, event_id, event_type, payload, processed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [hookId, provider, eventId, eventType, JSON.stringify(payload)]
      );
      const claimed = Boolean(res.rows && res.rows.length > 0);
      if (claimed) this.recordWebhookEvent(provider, eventId, eventType);
      return claimed;
    }
    if (this.isWebhookProcessed(provider, eventId)) return false;
    this.recordWebhookEvent(provider, eventId, eventType);
    return true;
  }

  public recordWebhookEvent(provider: string, eventId: string, eventType: string = 'generic'): void {
    if (!this.state.webhookEvents) this.state.webhookEvents = {};
    const key = `${provider}:${eventId}`;
    this.state.webhookEvents[key] = {
      provider,
      eventId,
      eventType,
      processedAt: new Date().toISOString(),
    };
    this.persistToDisk();
  }

  // --- Profile Quota Ledger (Atomic 3-profile daily limit in Asia/Kolkata) ---
  public getDistinctDailyViews(viewerId: string, dateKey?: string): ProfileViewLedgerEntry[] {
    const key = dateKey || getKolkataDateKey();
    return this.state.profileViewLedger.filter(
      (entry) => entry.viewerId === viewerId && entry.dateKey === key
    );
  }

  public recordProfileView(
    viewerId: string,
    targetId: string
  ): { allowed: boolean; remaining: number; alreadyViewedToday: boolean } {
    if (viewerId === targetId) {
      return { allowed: true, remaining: 3, alreadyViewedToday: true };
    }

    const viewer = this.getMemberById(viewerId);
    if (!viewer) return { allowed: false, remaining: 0, alreadyViewedToday: false };

    if (viewer.plan === 'premium') {
      return { allowed: true, remaining: 9999, alreadyViewedToday: false };
    }

    const dateKey = getKolkataDateKey();
    const todayEntries = this.getDistinctDailyViews(viewerId, dateKey);
    const existing = todayEntries.find((e) => e.targetId === targetId);

    if (existing) {
      const uniqueTargets = new Set(todayEntries.map((e) => e.targetId));
      return {
        allowed: true,
        remaining: Math.max(0, 3 - uniqueTargets.size),
        alreadyViewedToday: true,
      };
    }

    const uniqueTargets = new Set(todayEntries.map((e) => e.targetId));
    if (uniqueTargets.size >= 3) {
      return { allowed: false, remaining: 0, alreadyViewedToday: false };
    }

    const entry: ProfileViewLedgerEntry = {
      id: `view_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      viewerId,
      targetId,
      dateKey,
      viewedAt: new Date().toISOString(),
    };
    this.state.profileViewLedger.push(entry);
    uniqueTargets.add(targetId);
    this.persistToDisk();

    if (isNeonConfigured()) {
      QuotaRepository.recordViewIfEligible(viewerId, targetId, dateKey, false).catch((err) => {
        console.error('Failed to sync profile view to Neon:', err);
      });
    }

    return { allowed: true, remaining: Math.max(0, 3 - uniqueTargets.size), alreadyViewedToday: false };
  }

  // --- Connections ---
  public getConnectionState(userA: string, userB: string): ConnectionRecord | null {
    for (const conn of Object.values(this.state.connections)) {
      if (
        (conn.requesterId === userA && conn.recipientId === userB) ||
        (conn.requesterId === userB && conn.recipientId === userA)
      ) {
        return conn;
      }
    }
    return null;
  }

  public sendConnectionRequest(
    fromId: string,
    toId: string,
    introMessage?: string
  ): ConnectionRecord {
    if (this.isBlocked(fromId, toId)) {
      throw new Error('Action blocked due to safety settings');
    }
    const existing = this.getConnectionState(fromId, toId);
    if (existing) {
      if (existing.status === 'blocked') throw new Error('Cannot connect with this member');
      if (existing.status === 'accepted') throw new Error('Already connected');
      if (existing.status === 'request_sent') throw new Error('Request already pending');
    }

    const record: ConnectionRecord = {
      id: `conn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      requesterId: fromId,
      recipientId: toId,
      status: 'request_sent',
      introMessage: introMessage?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.connections[record.id] = record;
    this.persistToDisk();
    if (isNeonConfigured()) {
      ConnectionsRepository.setStatus(fromId, toId, 'request_sent', introMessage).catch((err) => {
        console.error('Failed to sync connection request to Neon:', err);
      });
    }
    return record;
  }

  public respondToConnection(
    connectionId: string,
    responderId: string,
    action: 'accept' | 'reject' | 'withdraw'
  ): ConnectionRecord {
    const conn = this.state.connections[connectionId];
    if (!conn) throw new Error('Connection request not found');

    if (action === 'withdraw') {
      if (conn.requesterId !== responderId) throw new Error('Only sender can withdraw');
      conn.status = 'withdrawn';
    } else {
      if (conn.recipientId !== responderId) throw new Error('Unauthorized responder');
      conn.status = action === 'accept' ? 'accepted' : 'rejected';
    }
    conn.updatedAt = new Date().toISOString();
    this.persistToDisk();
    if (isNeonConfigured()) {
      ConnectionsRepository.setStatus(conn.requesterId, conn.recipientId, conn.status).catch((err) => {
        console.error('Failed to sync connection response to PostgreSQL:', err);
      });
    }
    return conn;
  }

  public async sendConnectionRequestAsync(
    fromId: string,
    toId: string,
    introMessage?: string
  ): Promise<ConnectionRecord> {
    const conn = this.sendConnectionRequest(fromId, toId, introMessage);
    if (isNeonConfigured()) {
      await ConnectionsRepository.setStatus(fromId, toId, 'request_sent', introMessage);
    }
    return conn;
  }

  public async respondToConnectionAsync(
    connectionId: string,
    responderId: string,
    action: 'accept' | 'reject' | 'withdraw'
  ): Promise<ConnectionRecord> {
    const conn = this.respondToConnection(connectionId, responderId, action);
    if (isNeonConfigured()) {
      await ConnectionsRepository.setStatus(conn.requesterId, conn.recipientId, conn.status);
    }
    return conn;
  }

  public removeConnection(userId1: string, userId2: string): boolean {
    const conn = this.getConnectionState(userId1, userId2);
    if (conn) {
      conn.status = 'removed';
      conn.updatedAt = new Date().toISOString();
      this.persistToDisk();
      return true;
    }
    return false;
  }

  public getAllConnections(): ConnectionRecord[] {
    return Object.values(this.state.connections);
  }

  // --- Blocking ---
  public blockMember(blockerId: string, blockedId: string): void {
    const key = `${blockerId}:${blockedId}`;
    if (!this.state.blockedUsers.includes(key)) {
      this.state.blockedUsers.push(key);
    }
    const conn = this.getConnectionState(blockerId, blockedId);
    if (conn) {
      conn.status = 'blocked';
      conn.updatedAt = new Date().toISOString();
    }
    this.persistToDisk();
    if (isNeonConfigured()) {
      ConnectionsRepository.blockUser(blockerId, blockedId).catch((err) => {
        console.error('Failed to sync block to Neon:', err);
      });
    }
  }

  public unblockMember(blockerId: string, blockedId: string): void {
    const key = `${blockerId}:${blockedId}`;
    const idx = this.state.blockedUsers.indexOf(key);
    if (idx !== -1) {
      this.state.blockedUsers.splice(idx, 1);
    }
    const conn = this.getConnectionState(blockerId, blockedId);
    if (conn && conn.status === 'blocked') {
      conn.status = 'removed';
      conn.updatedAt = new Date().toISOString();
    }
    this.persistToDisk();
  }

  public isBlocked(userA: string, userB: string): boolean {
    return (
      this.state.blockedUsers.includes(`${userA}:${userB}`) ||
      this.state.blockedUsers.includes(`${userB}:${userA}`)
    );
  }

  // --- Messaging ---
  public sendMessage(senderId: string, recipientId: string, content: string): DirectMessage {
    if (this.isBlocked(senderId, recipientId)) {
      throw new Error('Message blocked by privacy boundary');
    }

    const conn = this.getConnectionState(senderId, recipientId);
    if (!conn || conn.status !== 'accepted') {
      throw new Error('Direct messages permitted only between accepted connections');
    }

    let conv: Conversation | undefined;
    for (const c of Object.values(this.state.conversations)) {
      if (
        (c.participantIds[0] === senderId && c.participantIds[1] === recipientId) ||
        (c.participantIds[0] === recipientId && c.participantIds[1] === senderId)
      ) {
        conv = c;
        break;
      }
    }

    if (!conv) {
      conv = {
        id: `conv_${senderId}_${recipientId}_${Date.now()}`,
        participantIds: [senderId, recipientId],
        unreadCounts: { [senderId]: 0, [recipientId]: 1 },
        updatedAt: new Date().toISOString(),
      };
      this.state.conversations[conv.id] = conv;
    } else {
      conv.unreadCounts[recipientId] = (conv.unreadCounts[recipientId] || 0) + 1;
      conv.updatedAt = new Date().toISOString();
    }

    const msg: DirectMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      conversationId: conv.id,
      senderId,
      recipientId,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      status: 'delivered',
    };

    conv.lastMessage = {
      content: msg.content,
      timestamp: msg.timestamp,
      senderId,
    };

    this.state.messages.push(msg);
    this.persistToDisk();
    if (isNeonConfigured()) {
      MessagesRepository.sendMessage(senderId, recipientId, content).catch((err) => {
        console.error('Failed to sync message to PostgreSQL:', err);
      });
    }
    return msg;
  }

  public async blockMemberAsync(blockerId: string, blockedId: string): Promise<void> {
    this.blockMember(blockerId, blockedId);
    if (isNeonConfigured()) {
      await ConnectionsRepository.blockUser(blockerId, blockedId);
    }
  }

  public async sendMessageAsync(senderId: string, recipientId: string, content: string): Promise<DirectMessage> {
    const msg = this.sendMessage(senderId, recipientId, content);
    if (isNeonConfigured()) {
      await MessagesRepository.sendMessage(senderId, recipientId, content);
    }
    return msg;
  }

  public getMessagesForConversation(conversationId: string): DirectMessage[] {
    return this.state.messages.filter((m) => m.conversationId === conversationId);
  }

  public getAllConversations(): Conversation[] {
    return Object.values(this.state.conversations);
  }

  public getConversationById(id: string): Conversation | null {
    return this.state.conversations[id] || null;
  }

  public markMessagesRead(conversationId: string, readerId: string): void {
    const conv = this.state.conversations[conversationId];
    if (conv) {
      conv.unreadCounts[readerId] = 0;
    }
    for (const msg of this.state.messages) {
      if (msg.conversationId === conversationId && msg.recipientId === readerId) {
        msg.status = 'read';
      }
    }
    this.persistToDisk();
  }

  // --- Verification Reviews ---
  public submitVerificationRequest(
    memberId: string,
    category: 'identity' | 'institution' | 'organization',
    evidenceSummary: string
  ): VerificationRequest {
    const member = this.getMemberById(memberId);
    if (!member) throw new Error('Member not found');

    const req: VerificationRequest = {
      id: `vreq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      memberId: member.id,
      memberName: member.fullName,
      memberEmail: member.email,
      category,
      evidenceSummary,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.state.verificationRequests[req.id] = req;
    this.persistToDisk();
    return req;
  }

  public reviewVerification(
    requestId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    notes: string
  ): VerificationRequest {
    const req = this.state.verificationRequests[requestId];
    if (!req) throw new Error('Verification request not found');

    req.status = decision;
    req.reviewerNotes = notes;
    req.reviewedBy = reviewerId;
    req.reviewedAt = new Date().toISOString();

    const member = this.getMemberById(req.memberId);
    if (member) {
      if (decision === 'approved') {
        member.isVerified = true;
        member.verifiedCategory = req.category;
        member.verifiedAt = req.reviewedAt;
      } else {
        member.isVerified = false;
      }
    }

    const audit: VerificationAuditLog = {
      id: `audit_${Date.now()}`,
      requestId,
      memberId: req.memberId,
      action: decision,
      reviewer: reviewerId,
      category: req.category,
      notes,
      timestamp: new Date().toISOString(),
    };
    this.state.verificationAuditLogs.push(audit);
    this.persistToDisk();
    if (isNeonConfigured()) {
      VerificationRepository.recordDecision(requestId, reviewerId, decision, notes).catch((err) => {
        console.error('Failed to sync verification decision to Neon:', err);
      });
    }
    return req;
  }

  public revokeVerification(memberId: string, reviewerId: string, reason: string): void {
    const member = this.getMemberById(memberId);
    if (!member) throw new Error('Member not found');
    member.isVerified = false;
    member.verifiedCategory = undefined;
    member.verifiedAt = undefined;

    const audit: VerificationAuditLog = {
      id: `audit_revoke_${Date.now()}`,
      requestId: 'revocation',
      memberId,
      action: 'revoked',
      reviewer: reviewerId,
      category: 'identity',
      notes: reason,
      timestamp: new Date().toISOString(),
    };
    this.state.verificationAuditLogs.push(audit);
    this.persistToDisk();
    if (isNeonConfigured()) {
      VerificationRepository.recordRevocation(memberId, reviewerId, reason).catch((err) => {
        console.error('Failed to sync verification revocation to Neon:', err);
      });
    }
  }

  public getAllVerificationRequests(): VerificationRequest[] {
    return Object.values(this.state.verificationRequests);
  }

  public getVerificationAuditLogs(): VerificationAuditLog[] {
    return this.state.verificationAuditLogs;
  }

  // --- Abuse Reports & Moderation ---
  public submitAbuseReport(
    reporterId: string,
    reportedMemberId: string,
    reason: string,
    details?: string
  ): AbuseReport {
    const report: AbuseReport = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      reporterId,
      reportedMemberId,
      reason,
      details: details || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    if (!this.state.abuseReports) {
      this.state.abuseReports = {};
    }
    this.state.abuseReports[report.id] = report;
    this.persistToDisk();
    return report;
  }

  public getAbuseReports(): AbuseReport[] {
    return Object.values(this.state.abuseReports || {});
  }

  // --- Notifications ---
  public addNotification(
    recipientId: string,
    type: AppNotification['type'],
    title: string,
    body: string,
    actorId?: string
  ): AppNotification {
    const notif: AppNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      recipientId,
      actorId,
      type,
      title,
      body,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    this.state.notifications.unshift(notif);
    this.persistToDisk();
    if (isNeonConfigured()) {
      NotificationsRepository.addNotification(recipientId, type, title, body, actorId).catch((err) => {
        console.error('Failed to sync notification to Neon:', err);
      });
    }
    return notif;
  }

  public getNotificationsForUser(userId: string): AppNotification[] {
    return this.state.notifications.filter((n) => n.recipientId === userId);
  }

  public markNotificationRead(notifId: string): void {
    const n = this.state.notifications.find((notif) => notif.id === notifId);
    if (n) {
      n.isRead = true;
      this.persistToDisk();
    }
  }

  // --- Saved Profiles ---
  public saveMemberBookmark(userId: string, targetMemberId: string): boolean {
    if (userId === targetMemberId) return false;
    if (!this.state.savedMembers) this.state.savedMembers = {};
    if (!this.state.savedMembers[userId]) this.state.savedMembers[userId] = [];
    if (!this.state.savedMembers[userId].includes(targetMemberId)) {
      this.state.savedMembers[userId].push(targetMemberId);
      this.persistToDisk();
      return true;
    }
    return false;
  }

  public removeMemberBookmark(userId: string, targetMemberId: string): boolean {
    if (!this.state.savedMembers || !this.state.savedMembers[userId]) return false;
    const idx = this.state.savedMembers[userId].indexOf(targetMemberId);
    if (idx !== -1) {
      this.state.savedMembers[userId].splice(idx, 1);
      this.persistToDisk();
      return true;
    }
    return false;
  }

  public getSavedMembers(userId: string): MemberProfile[] {
    if (!this.state.savedMembers || !this.state.savedMembers[userId]) return [];
    const targetIds = this.state.savedMembers[userId];
    const list: MemberProfile[] = [];
    for (const tid of targetIds) {
      const member = this.getMemberById(tid);
      if (!member) continue;
      // Privacy and safety filter: never show blocked, restricted, or private profiles
      if (this.isBlocked(userId, tid) || member.isRestricted) continue;
      if (member.profileVisibility === 'private') continue;
      list.push(member);
    }
    return list;
  }

  public isMemberSaved(userId: string, targetMemberId: string): boolean {
    return Boolean(this.state.savedMembers?.[userId]?.includes(targetMemberId));
  }

  // --- Authentic Profile Stats ---
  public getProfileStats(userId: string) {
    const member = this.getMemberById(userId);
    const publishedProjects = member?.projects?.length || 0;
    const listedSkills = member?.skills?.length || 0;

    let connectionsCount = 0;
    for (const conn of Object.values(this.state.connections)) {
      if (conn.status === 'accepted' && (conn.requesterId === userId || conn.recipientId === userId)) {
        connectionsCount++;
      }
    }

    const dateKey = getKolkataDateKey();
    const todayEntries = this.getDistinctDailyViews(userId, dateKey);
    const dailyViewsUsed = new Set(todayEntries.map((e) => e.targetId)).size;

    // Legitimate distinct views received from other users
    const receivedViews = this.state.profileViewLedger.filter(
      (e) => e.targetId === userId && e.viewerId !== userId
    ).length;

    return {
      fullName: member?.fullName || 'Member',
      headline: member?.headline || '',
      publishedProjects,
      listedSkills,
      connectionsCount,
      dailyViewsUsed,
      dailyViewsRemaining: Math.max(0, 3 - dailyViewsUsed),
      totalReceivedViews: receivedViews,
      isVerified: Boolean(member?.isVerified),
      verifiedCategory: member?.verifiedCategory || null,
      plan: member?.plan || 'free',
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __collaborate_durable_db__: DurableCollaborateDatabase | undefined;
}

export const durableDb: DurableCollaborateDatabase =
  globalThis.__collaborate_durable_db__ ||
  (globalThis.__collaborate_durable_db__ = new DurableCollaborateDatabase());
