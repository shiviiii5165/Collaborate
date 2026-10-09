import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRecommendationsForMember } from '@/lib/recommendations';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, userId } = body;
    const member = db.members.get(userId || 'usr_rahul');

    if (!member) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const cleanPrompt = (prompt || '').toLowerCase().trim();
    let reply = '';
    let quickActions: string[] = [];

    if (cleanPrompt.includes('collaborator') || cleanPrompt.includes('project')) {
      const recs = getRecommendationsForMember(member.id, 2);
      const names = recs.map((r) => `${r.member.fullName} (${r.member.headline.split('|')[0].trim()})`).join(' and ');
      reply = `Based on your featured project "${member.projects[0]?.title || 'Tathastu AI Assistant'}", I recommend connecting with ${names}. Both have complementary expertise in Vision Transformers and Distributed ML that would elevate your RAG evaluation benchmarks!`;
      quickActions = ['Send Connection Request to Priya', 'View Project Details', 'Share Pitch Note'];
    } else if (cleanPrompt.includes('github') || cleanPrompt.includes('profile')) {
      reply = `Rahul, your GitHub has ${member.metrics.githubContributions} contributions this year, which is strong! To stand out to top AI engineering teams, consider pinning your "Tathastu AI Assistant" repository, adding architectural diagrams (Mermaid or system graphs) to its README, and documenting reproducible evaluation benchmarks with latency metrics.`;
      quickActions = ['Edit Featured Projects', 'Update Headline', 'Sync with Tathastu'];
    } else if (cleanPrompt.includes('internship') || cleanPrompt.includes('opportunity')) {
      reply = `Given your goal of becoming a GenAI Engineer, researchers and engineers at Google (like Aman Verma) and IIIT Delhi are actively looking for collaborators on LLM evaluation pipelines. Reaching out with a specific question on their published work has an 82% higher acceptance rate!`;
      quickActions = ['Discover ML Engineers', 'Draft Outreach Message'];
    } else if (cleanPrompt.includes('roadmap') || cleanPrompt.includes('genai engineer')) {
      reply = `Your GenAI Engineer roadmap is currently at Level 3 of 5. You have mastered RAG architectures and vector databases. The next critical milestone is mastering multi-GPU inference caching (e.g. vLLM / TensorRT-LLM) and synthetic data evaluation pipelines.`;
      quickActions = ['View Full Analysis', 'Explore Skills to Learn'];
    } else {
      reply = `Great to connect, ${member.fullName.split(' ')[0]}! I'm analyzing your current network and verified profile. How can I assist your technical journey today?`;
      quickActions = ['Find collaborators', 'Improve my profile', 'Review roadmap'];
    }

    return NextResponse.json({
      reply,
      quickActions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'EORA error' }, { status: 500 });
  }
}
