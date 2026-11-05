/**
 * Goal-aware matching inputs.
 *
 *   viewerNeeds(member)    what the member is trying to get better at, strongest signal first:
 *                            1. AI Tathastu's assessed open needs for their target role (goals.needs,
 *                               shared under the member's "eris" consent), by priority;
 *                            2. otherwise the focus skills of their target role (ROLE_FOCUS), at a
 *                               lower weight, because nothing says which of them they lack;
 *                          minus skills they already demonstrate with high confidence.
 *   candidateStrength()    how credible a candidate's evidence for one skill is (0..1), from AI
 *                          Tathastu's evidence-based proficiency and verification where shared,
 *                          otherwise Collaborate's own evidence confidence.
 *   skillRarity()          down-weights generic skills most members list (e.g. Python), so they
 *                          can't dominate a ranking.
 *
 * A member with no goals is not penalized: the goal dimension is simply not assessed for them.
 */
import type { MemberProfile } from '@collaborate/contracts';
import type { ProfileIntelligence, SkillInsight } from './profile-intelligence';
import { normalizeSkill } from './skills';

/** Focus skills per AI Tathastu career direction (ids from its 20-role catalog). Product judgement. */
export const ROLE_FOCUS: Record<string, string[]> = {
  ml_engineer: ['Machine Learning', 'PyTorch', 'scikit-learn', 'MLflow', 'Docker'],
  data_scientist: ['Statistics', 'SQL', 'Pandas', 'Machine Learning'],
  deep_learning_engineer: ['Deep Learning', 'PyTorch', 'CUDA', 'Transformers (architecture)'],
  generative_ai_engineer: ['Large Language Models', 'Retrieval-Augmented Generation', 'Fine-tuning', 'Vector Databases'],
  llm_application_engineer: ['Retrieval-Augmented Generation', 'Large Language Models', 'LangChain', 'LLM Evaluation', 'FastAPI'],
  llm_model_engineer: ['Fine-tuning', 'PyTorch', 'Distributed Training', 'Model Quantization'],
  mlops_engineer: ['Docker', 'Kubernetes', 'CI/CD', 'MLflow'],
  llmops_engineer: ['Kubernetes', 'LLM Evaluation', 'vLLM', 'Docker'],
  ai_agent_engineer: ['AI Agents', 'LangChain', 'Large Language Models', 'LLM Evaluation'],
  nlp_engineer: ['Natural Language Processing', 'Hugging Face Transformers', 'PyTorch'],
  computer_vision_engineer: ['Computer Vision', 'OpenCV', 'PyTorch', 'Object Detection'],
  multimodal_ai_engineer: ['Vision-Language Models', 'Computer Vision', 'Natural Language Processing'],
  speech_ai_engineer: ['Speech Recognition', 'Audio Signal Processing', 'PyTorch'],
  rl_engineer: ['Reinforcement Learning', 'PyTorch', 'Simulation'],
  robotics_ai_engineer: ['ROS', 'C++', 'Computer Vision', 'Simulation'],
  graph_ai_engineer: ['Graph Neural Networks', 'Knowledge Graphs', 'PyTorch'],
  ai_infrastructure_engineer: ['Kubernetes', 'CUDA', 'Distributed Training', 'Terraform'],
  ai_evaluation_safety_engineer: ['LLM Evaluation', 'AI Safety', 'Statistics'],
  edge_federated_ai_engineer: ['On-device ML', 'Federated Learning', 'Model Quantization', 'ONNX'],
  ai_researcher: ['Deep Learning', 'PyTorch', 'Transformers (architecture)', 'Linear Algebra'],
};

const PRIORITY_WEIGHT = { High: 1, Medium: 0.7, Low: 0.4 } as const;
const ROLE_FOCUS_WEIGHT = 0.5;
const MAX_NEEDS = 8;

export interface Need {
  canonical: string;
  name: string;
  weight: number;
  source: 'assessed_gap' | 'role_focus';
}

export interface ViewerGoals {
  roleLabel: string | null;
  needs: Need[];
}

export function viewerGoals(m: MemberProfile, intel: ProfileIntelligence): ViewerGoals {
  const imp = m.importedProfile;
  const goals = imp?.goals ?? null;
  const roleId = goals?.targetRole?.id ?? imp?.identity.careerRoleId ?? null;
  const roleLabel = goals?.targetRole?.label ?? imp?.identity.careerRoleLabel ?? null;
  const strongAlready = new Set(intel.skills.filter((s) => s.confidence === 'high').map((s) => s.canonical));

  const out = new Map<string, Need>();
  const add = (name: string, weight: number, source: Need['source']) => {
    const canonical = normalizeSkill(name);
    if (!canonical || strongAlready.has(canonical)) return;
    const prev = out.get(canonical);
    if (!prev || prev.weight < weight) out.set(canonical, { canonical, name, weight, source });
  };
  for (const n of goals?.needs ?? []) add(n.skill, PRIORITY_WEIGHT[n.priority] ?? 0.4, 'assessed_gap');
  // Role focus only fills in when AI Tathastu didn't assess the role (otherwise its gaps are better).
  if (!goals?.assessed && roleId) for (const s of ROLE_FOCUS[roleId] ?? []) add(s, ROLE_FOCUS_WEIGHT, 'role_focus');

  const needs = [...out.values()].sort((a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical)).slice(0, MAX_NEEDS);
  return { roleLabel, needs };
}

/** 0..1 credibility of a candidate's evidence for one skill. Never above what the evidence supports. */
export function candidateStrength(m: MemberProfile, s: SkillInsight): { value: number; label: string } {
  const imp = (m.importedProfile?.skills ?? []).find((x) => normalizeSkill(x.name) === s.canonical);
  const base = s.confidence === 'high' ? 0.85 : s.confidence === 'medium' ? 0.55 : 0.3;
  if (imp && typeof imp.proficiency === 'number') {
    // AI Tathastu's 0-100 score from demonstrated work; verification adds a little, a claim doesn't.
    const value = Math.min(1, Math.max(0.2, imp.proficiency / 100) + (imp.verified ? 0.15 : 0));
    return { value, label: `${imp.level ?? 'assessed'}${imp.verified ? ', verified' : ''} on AI Tathastu` };
  }
  return { value: base, label: s.evidence[0] ?? 'listed' };
}

/** Rarity weight in (0,1]: 1 for skills few members list, lower for ones nearly everyone lists. */
export function skillRarity(df: Map<string, number>, total: number, canonical: string): number {
  if (total < 5) return 1; // too few members to know what's generic
  const share = (df.get(canonical) ?? 0) / total;
  return Math.max(0.25, Math.min(1, 1 - (share - 0.2) * 1.25));
}
