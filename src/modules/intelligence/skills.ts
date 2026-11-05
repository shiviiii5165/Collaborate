/**
 * Skill normalization and domain taxonomy. Deterministic and explainable: a skill maps to a
 * domain only through the explicit table below, never through guessing.
 */

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  'node.js': 'nodejs',
  node: 'nodejs',
  'react.js': 'react',
  reactjs: 'react',
  'next.js': 'nextjs',
  py: 'python',
  golang: 'go',
  postgresql: 'postgres',
  'postgre sql': 'postgres',
  k8s: 'kubernetes',
  'machine learning': 'ml',
  'deep learning': 'dl',
  'large language models': 'llm',
  llms: 'llm',
  'gen ai': 'genai',
  'generative ai': 'genai',
  'computer vision': 'cv',
  'natural language processing': 'nlp',
  'c plus plus': 'c++',
  cpp: 'c++',
  tf: 'tensorflow',
  'scikit learn': 'scikit-learn',
  sklearn: 'scikit-learn',
  'amazon web services': 'aws',
  gcp: 'google cloud',
  'ui/ux': 'ux design',
  ux: 'ux design',
  // AI Tathastu canonical names (worker/skills_catalog.py) → the keys used here.
  'retrieval-augmented generation': 'rag',
  'retrieval augmented generation': 'rag',
  'reinforcement learning': 'rl',
  'hugging face transformers': 'hugging face',
  huggingface: 'hugging face',
  'robot operating system': 'ros',
  ros2: 'ros',
  'graph neural networks': 'gnn',
  gnns: 'gnn',
  'vector databases': 'vector database',
  'ci/cd': 'ci cd',
  'speech recognition': 'asr',
  'automatic speech recognition': 'asr',
  'ai agents': 'agents',
  'agentic ai': 'agents',
  'llm agents': 'agents',
};

/** Canonical key used for comparison. Display names are kept as the member wrote them. */
export function normalizeSkill(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[s] ?? s;
}

export const DOMAINS: Record<string, string[]> = {
  'AI / Machine Learning': ['ml', 'dl', 'llm', 'genai', 'nlp', 'cv', 'pytorch', 'tensorflow', 'jax', 'scikit-learn', 'rag', 'langchain', 'transformers', 'vision transformers', 'hugging face', 'mlops', 'tensorrt-llm', 'vllm', 'cuda'],
  'Data Engineering': ['sql', 'postgres', 'spark', 'kafka', 'airflow', 'dbt', 'etl', 'data pipelines', 'bigquery', 'snowflake', 'pandas'],
  'Web Development': ['javascript', 'typescript', 'react', 'nextjs', 'vue', 'angular', 'html', 'css', 'tailwind', 'nodejs', 'graphql'],
  'Backend & Systems': ['go', 'rust', 'java', 'c++', 'c', 'nodejs', 'fastapi', 'django', 'flask', 'distributed systems', 'microservices', 'grpc', 'elixir', 'haskell', 'zig', 'ocaml'],
  'Cloud & DevOps': ['aws', 'azure', 'google cloud', 'kubernetes', 'docker', 'terraform', 'ci/cd', 'linux'],
  Mobile: ['android', 'ios', 'kotlin', 'swift', 'flutter', 'react native'],
  'Security': ['security', 'cryptography', 'penetration testing', 'appsec'],
  'Design & Product': ['ux design', 'figma', 'product management', 'product design'],
};

const SKILL_TO_DOMAINS = new Map<string, string[]>();
for (const [domain, skills] of Object.entries(DOMAINS)) {
  for (const s of skills) SKILL_TO_DOMAINS.set(s, [...(SKILL_TO_DOMAINS.get(s) ?? []), domain]);
}

export function domainsForSkill(canonical: string): string[] {
  return SKILL_TO_DOMAINS.get(canonical) ?? [];
}
