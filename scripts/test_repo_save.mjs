import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (match) process.env[match[1]] = match[2];
  }
}

async function test() {
  const { MembersRepository } = await import('../src/lib/db/repositories/members.ts');
  console.log('Testing MembersRepository.saveMember...');
  try {
    const testMember = {
      id: 'test_direct_usr_' + Date.now(),
      email: 'test_direct_' + Date.now() + '@example.com',
      fullName: 'Direct Repo Test User',
      headline: 'Tester',
      avatarUrl: '/images/avatar.jpg',
      bannerUrl: '/images/banner.jpg',
      isVerified: false,
      plan: 'free',
      statusBadges: ['Tester'],
      location: 'India',
      about: 'About tester',
      contextTags: ['test'],
      socialLinks: {},
      metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '0', leetcodeProblems: '0', publications: 0 },
      skills: ['TypeScript'],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: [],
      collaborationInterests: [],
      discoverable: true,
      profileVisibility: 'public',
      contactVisibility: 'connections_only',
      isLinkedWithTathastu: false,
      tathastuSyncStatus: 'unlinked',
      tathastuSyncSettings: { autoSyncProjects: false, autoSyncSkills: false, autoSyncAchievements: false },
      isUnder18: false,
      safeguardingApproved: false,
      role: 'member',
    };
    await MembersRepository.saveMember(testMember);
    console.log('Successfully saved to Supabase PostgreSQL!');

    const retrieved = await MembersRepository.findById(testMember.id);
    console.log('Retrieved from Supabase PostgreSQL:', retrieved ? retrieved.id : 'NOT FOUND');
  } catch (err) {
    console.error('Error during test:', err);
  }
}

test();
