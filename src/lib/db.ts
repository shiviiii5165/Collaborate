import {
  MemberProfile,
  ConnectionRecord,
  DirectMessage,
  Conversation,
  VerificationRequest,
  VerificationAuditLog,
  AbuseReport,
  ProfileViewLedgerEntry,
} from './types';

// Helper to get today's date key in Asia/Kolkata
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

// In-Memory persistent singleton for dev server runtime
class CollaborateDatabase {
  public members: Map<string, MemberProfile> = new Map();
  public connections: Map<string, ConnectionRecord> = new Map();
  public conversations: Map<string, Conversation> = new Map();
  public messages: DirectMessage[] = [];
  public verificationRequests: Map<string, VerificationRequest> = new Map();
  public verificationAuditLogs: VerificationAuditLog[] = [];
  public abuseReports: Map<string, AbuseReport> = new Map();
  public profileViewLedger: ProfileViewLedgerEntry[] = [];
  public blockedUsers: Set<string> = new Set(); // "blocker:blocked"

  constructor() {
    this.seed();
  }

  private seed() {
    // 1. Rahul Sharma (Primary user matching screenshot)
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
      role: 'member',
    };

    // 2. Priya Mehta
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
        'Doctoral researcher at IIIT Delhi specializing in self-supervised computer vision models and federated medical diagnostics. Passionate about ethical AI applications and clinical validation.',
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
      skills: ['PyTorch', 'Computer Vision', 'Vision Transformers', 'Self-Supervised Learning', 'Medical Imaging', 'Python'],
      projects: [
        {
          id: 'proj_p1',
          title: 'MedVision-ViT',
          featured: true,
          description: 'Transformer based anomaly segmentation for multi-modal radiology.',
          tags: ['PyTorch', 'Vision Transformers', 'DICOM'],
          stars: 180,
          forks: 34,
        },
      ],
      experience: [
        {
          id: 'exp_p1',
          role: 'Visiting AI Research Fellow',
          company: 'AIIMS Research Wing',
          period: 'Jan 2025 – Present',
          bullets: ['Evaluating transformer models for ultrasound diagnostic accuracy.'],
        },
      ],
      education: [
        {
          id: 'edu_p1',
          institution: 'Indraprastha Institute of Information Technology Delhi (IIITD)',
          period: '2023 – 2027',
          degree: 'Ph.D. in Computer Science (Computer Vision)',
          score: 'CGPA: 9.2 / 10',
        },
      ],
      recentActivity: [
        {
          id: 'act_p1',
          type: 'publication',
          title: 'Published paper in CVPR Workshop 2026',
          timeAgo: '3 days ago',
        },
      ],
      aiSpecializations: ['Computer Vision', 'Medical Diagnostics', 'Multi-Modal Representation'],
      collaborationInterests: ['Model-evaluation collaborations', 'Clinical dataset curation'],
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
      role: 'member',
    };

    // 3. Aman Verma
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
      about:
        'Building high-scale distributed training orchestration and GPU cluster optimization pipelines. Alumnus of IIT Bombay. Mentor for budding systems and ML infrastructure engineers.',
      contextTags: ['Google', 'IIT Bombay', 'aman.verma@google.com'],
      socialLinks: {
        github: 'https://github.com/amanverma-ml',
        linkedin: 'https://linkedin.com/in/amanverma-google',
      },
      metrics: {
        projects: 15,
        skills: 35,
        achievements: 9,
        githubContributions: '650+',
        leetcodeProblems: '920+',
        publications: 3,
      },
      skills: ['Distributed Systems', 'Ray', 'CUDA', 'TensorRT', 'Kubernetes', 'Python', 'C++'],
      projects: [
        {
          id: 'proj_a1',
          title: 'TorchDist-Optimizer',
          featured: true,
          description: 'Zero-redundancy distributed optimizer reduction tool for billion-parameter weights.',
          tags: ['Python', 'CUDA', 'PyTorch'],
          stars: 430,
          forks: 72,
        },
      ],
      experience: [
        {
          id: 'exp_a1',
          role: 'Machine Learning Engineer',
          company: 'Google',
          period: '2023 – Present',
          bullets: ['Orchestrating multi-node cluster scheduling for enterprise foundation models.'],
        },
      ],
      education: [
        {
          id: 'edu_a1',
          institution: 'Indian Institute of Technology Bombay (IITB)',
          period: '2019 – 2023',
          degree: 'B.Tech in Computer Science',
          score: 'CGPA: 9.4 / 10',
        },
      ],
      recentActivity: [
        {
          id: 'act_a1',
          type: 'github',
          title: 'Contributed to vLLM kernel optimization',
          timeAgo: '1 day ago',
        },
      ],
      aiSpecializations: ['Distributed ML Systems', 'Inference Acceleration', 'GPU Scheduling'],
      collaborationInterests: ['Open source distributed training', 'Mentoring young engineers'],
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
      role: 'member',
    };

    // 4. Neha Kapoor
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
      about:
        'Building next-gen conversational workflows, agentic memory networks, and multi-tenant RAG systems. Passionate about empowering students through open tech tools.',
      contextTags: ['LPU', 'neha.dev', 'neha.kapoor@lpu.in'],
      socialLinks: {
        github: 'https://github.com/nehakapoor-genai',
        linkedin: 'https://linkedin.com/in/nehakapoor-builder',
      },
      metrics: {
        projects: 9,
        skills: 22,
        achievements: 3,
        githubContributions: '280+',
        leetcodeProblems: '510+',
        publications: 1,
      },
      skills: ['LangChain', 'FastAPI', 'Pinecone', 'Next.js', 'Python', 'Vector DBs', 'RAG'],
      projects: [
        {
          id: 'proj_n1',
          title: 'CampusAssist RAG',
          featured: true,
          description: 'University syllabus & notices query assistant with hybrid lexical/vector search.',
          tags: ['Python', 'Pinecone', 'LangChain'],
          stars: 64,
          forks: 18,
        },
      ],
      experience: [
        {
          id: 'exp_n1',
          role: 'Student Developer Lead',
          company: 'LPU Coding Community',
          period: '2024 – Present',
          bullets: ['Organized hands-on GenAI workshops for 400+ undergraduates.'],
        },
      ],
      education: [
        {
          id: 'edu_n1',
          institution: 'Lovely Professional University (LPU)',
          period: '2022 – 2026',
          degree: 'B.Tech in Computer Science',
          score: 'CGPA: 8.7 / 10',
        },
      ],
      recentActivity: [
        {
          id: 'act_n1',
          type: 'project',
          title: 'Released CampusAssist v2 beta',
          timeAgo: '4 hours ago',
        },
      ],
      aiSpecializations: ['Agentic RAG', 'Hybrid Search', 'Vector Embeddings'],
      collaborationInterests: ['GenAI hackathons', 'RAG evaluation frameworks'],
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
      role: 'member',
    };

    // 5. Admin user (Devansh Sharma - Tathastu Safety Admin)
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
      metrics: {
        projects: 0,
        skills: 10,
        achievements: 0,
        githubContributions: '0',
        leetcodeProblems: '0',
        publications: 0,
      },
      skills: ['Moderation', 'Audit Compliance', 'OIDC Federation', 'Identity Verification'],
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
      tathastuSyncSettings: {
        autoSyncProjects: false,
        autoSyncSkills: false,
        autoSyncAchievements: false,
      },
      role: 'admin',
    };

    this.members.set(rahul.id, rahul);
    this.members.set(priya.id, priya);
    this.members.set(aman.id, aman);
    this.members.set(neha.id, neha);
    this.members.set(admin.id, admin);

    // Initial Connections:
    // Rahul has accepted connection with Priya
    const conn1: ConnectionRecord = {
      id: 'conn_rahul_priya',
      requesterId: 'usr_priya',
      recipientId: 'usr_rahul',
      status: 'accepted',
      introMessage: 'Hi Rahul, I noticed your RAG assistant project and would love to connect!',
      createdAt: '2026-09-15T10:00:00Z',
      updatedAt: '2026-09-15T12:30:00Z',
    };
    this.connections.set(conn1.id, conn1);

    // Initial conversation between Rahul & Priya
    const conv1: Conversation = {
      id: 'conv_rahul_priya',
      participantIds: ['usr_rahul', 'usr_priya'],
      lastMessage: {
        content: 'I would love to run a test on your benchmark datasets this weekend!',
        timestamp: '2026-10-09T14:15:00Z',
        senderId: 'usr_priya',
      },
      unreadCounts: {
        usr_rahul: 1,
        usr_priya: 0,
      },
      updatedAt: '2026-10-09T14:15:00Z',
    };
    this.conversations.set(conv1.id, conv1);

    this.messages.push(
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
      }
    );

    // Initial pending verification request for Neha
    const req1: VerificationRequest = {
      id: 'vreq_neha',
      memberId: 'usr_neha',
      memberName: 'Neha Kapoor',
      memberEmail: 'neha.kapoor@lpu.in',
      category: 'institution',
      evidenceSummary: 'Official LPU student registration card (Registration ID: 12108745) valid through June 2026.',
      status: 'pending',
      createdAt: '2026-10-08T09:30:00Z',
    };
    this.verificationRequests.set(req1.id, req1);
  }

  // --- Profile Quota Management (3 distinct profiles / day in Asia/Kolkata) ---
  public getDistinctDailyViews(viewerId: string, dateKey?: string): ProfileViewLedgerEntry[] {
    const key = dateKey || getKolkataDateKey();
    return this.profileViewLedger.filter(
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

    const viewer = this.members.get(viewerId);
    if (!viewer) return { allowed: false, remaining: 0, alreadyViewedToday: false };

    // Premium users have unlimited authorized views
    if (viewer.plan === 'premium') {
      return { allowed: true, remaining: 9999, alreadyViewedToday: false };
    }

    const dateKey = getKolkataDateKey();
    const todayEntries = this.getDistinctDailyViews(viewerId, dateKey);
    const existing = todayEntries.find((e) => e.targetId === targetId);

    if (existing) {
      // Already viewed today: free re-view within same quota period!
      const uniqueTargets = new Set(todayEntries.map((e) => e.targetId));
      return {
        allowed: true,
        remaining: Math.max(0, 3 - uniqueTargets.size),
        alreadyViewedToday: true,
      };
    }

    // Check unique target count
    const uniqueTargets = new Set(todayEntries.map((e) => e.targetId));
    if (uniqueTargets.size >= 3) {
      return { allowed: false, remaining: 0, alreadyViewedToday: false };
    }

    // Atomic entry record
    const entry: ProfileViewLedgerEntry = {
      id: `view_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      viewerId,
      targetId,
      dateKey,
      viewedAt: new Date().toISOString(),
    };
    this.profileViewLedger.push(entry);

    uniqueTargets.add(targetId);
    const remaining = Math.max(0, 3 - uniqueTargets.size);
    return { allowed: true, remaining, alreadyViewedToday: false };
  }

  // --- Connection Queries & Actions ---
  public getConnectionState(userA: string, userB: string): ConnectionRecord | null {
    for (const conn of this.connections.values()) {
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
    this.connections.set(record.id, record);
    return record;
  }

  public respondToConnection(
    connectionId: string,
    responderId: string,
    action: 'accept' | 'reject' | 'withdraw'
  ): ConnectionRecord {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new Error('Connection request not found');

    if (action === 'withdraw') {
      if (conn.requesterId !== responderId) throw new Error('Only sender can withdraw');
      conn.status = 'withdrawn';
    } else {
      if (conn.recipientId !== responderId) throw new Error('Unauthorized responder');
      conn.status = action === 'accept' ? 'accepted' : 'rejected';
    }
    conn.updatedAt = new Date().toISOString();
    return conn;
  }

  public removeConnection(userId1: string, userId2: string): boolean {
    const conn = this.getConnectionState(userId1, userId2);
    if (conn) {
      conn.status = 'removed';
      conn.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  // --- Blocking & Safety ---
  public blockMember(blockerId: string, blockedId: string): void {
    this.blockedUsers.add(`${blockerId}:${blockedId}`);
    const conn = this.getConnectionState(blockerId, blockedId);
    if (conn) {
      conn.status = 'blocked';
      conn.updatedAt = new Date().toISOString();
    }
  }

  public isBlocked(userA: string, userB: string): boolean {
    return (
      this.blockedUsers.has(`${userA}:${userB}`) || this.blockedUsers.has(`${userB}:${userA}`)
    );
  }

  // --- Realtime Messaging (Only between accepted connections) ---
  public sendMessage(senderId: string, recipientId: string, content: string): DirectMessage {
    if (this.isBlocked(senderId, recipientId)) {
      throw new Error('Message blocked by privacy boundary');
    }

    const conn = this.getConnectionState(senderId, recipientId);
    if (!conn || conn.status !== 'accepted') {
      throw new Error('Direct messages permitted only between accepted connections');
    }

    // Find or create conversation
    let conv: Conversation | undefined;
    for (const c of this.conversations.values()) {
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
      this.conversations.set(conv.id, conv);
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

    this.messages.push(msg);
    return msg;
  }

  public markMessagesRead(conversationId: string, readerId: string): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.unreadCounts[readerId] = 0;
    }
    for (const msg of this.messages) {
      if (msg.conversationId === conversationId && msg.recipientId === readerId) {
        msg.status = 'read';
      }
    }
  }

  // --- Verification Review (Admin Only) ---
  public reviewVerification(
    requestId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    notes: string
  ): VerificationRequest {
    const req = this.verificationRequests.get(requestId);
    if (!req) throw new Error('Verification request not found');

    req.status = decision;
    req.reviewerNotes = notes;
    req.reviewedBy = reviewerId;
    req.reviewedAt = new Date().toISOString();

    const member = this.members.get(req.memberId);
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
    this.verificationAuditLogs.push(audit);

    return req;
  }

  public revokeVerification(memberId: string, reviewerId: string, reason: string): void {
    const member = this.members.get(memberId);
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
    this.verificationAuditLogs.push(audit);
  }
}

// Global singleton declaration to preserve state across HMR in Next.js development
declare global {
  // eslint-disable-next-line no-var
  var __collaborate_db__: CollaborateDatabase | undefined;
}

export const db: CollaborateDatabase =
  globalThis.__collaborate_db__ || (globalThis.__collaborate_db__ = new CollaborateDatabase());
