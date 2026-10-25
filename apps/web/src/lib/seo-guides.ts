// Canonical answer-first public guides. Rendered HTML, metadata, JSON-LD and
// machine-readable summaries use this single source; do not describe planned
// provider integrations as universally supported.
export type GuidePath = "/ai-agent-skill-management" | "/ai-skill-evaluation" | "/enterprise-ai-skill-governance";
export type SeoGuide = {
  path: GuidePath;
  title: string;
  description: string;
  headline: string;
  eyebrow: string;
  lede: string;
  published: string;
  keywords: string[];
  sections: { id: string; heading: string; paragraphs: string[]; bullets: string[] }[];
  faq: { question: string; answer: string }[];
  related: { path: GuidePath | "/docs" | "/catalog" | "/security"; label: string }[];
};

export const SEO_GUIDES: SeoGuide[] = [
  {
    "path": "/ai-agent-skill-management",
    "title": "AI Agent Skill Management",
    "description": "Manage AI agent skills as governed Git-backed assets. Learn how to organize skill ownership, versions, evaluations, approvals, and distribution across AI tools.",
    "headline": "AI agent skill management, from source to approved release.",
    "eyebrow": "Guide / Agent skill lifecycle",
    "lede": "AI agent skills become organizational assets when teams can identify their source, test changes, approve releases, and track where the approved version is used. Savant provides a governed lifecycle rather than a shared folder of prompts.",
    "published": "2026-10-25",
    "keywords": [
      "AI agent skill management",
      "agent skills registry",
      "managed AI skills",
      "SKILL.md management",
      "skills as code"
    ],
    "sections": [
      {
        "id": "definition",
        "heading": "What is AI agent skill management?",
        "paragraphs": [
          "AI agent skill management is the practice of controlling reusable instructions, tools, dependencies, ownership, and release state for AI-assisted work. A skill can encapsulate a repeatable method such as incident triage, document review, or architecture assessment. Unlike an ad hoc prompt, a managed skill has an identifiable version, an accountable owner, and acceptance evidence.",
          "The goal is not to make every agent behave identically. It is to make approved expertise discoverable, reusable, and reviewable when people and agents operate in different tools."
        ],
        "bullets": [
          "Record a canonical source and owner for each skill.",
          "Retain version history and the reason behind each change.",
          "Attach evaluation cases and regression criteria to the version.",
          "Govern promotion and rollback as release decisions."
        ]
      },
      {
        "id": "workflow",
        "heading": "A practical operating model for managed skills",
        "paragraphs": [
          "Start with a Git-backed skill registry instead of copying instructions between individual accounts. Import existing SKILL.md files or other approved source assets, classify them by scope, and establish who can propose, review, and release changes.",
          "Next, run candidate versions against representative tasks and holdout cases. Approval should refer to the exact content tested, not to the latest mutable document. Only then publish to authorized runtimes through mechanisms that the relevant provider supports."
        ],
        "bullets": [
          "Source: capture skill files, revision identifiers, dependencies, and ownership.",
          "Evaluate: measure correctness, instruction adherence, safety, cost, and regressions.",
          "Approve: require evidence and appropriate reviewers for high-impact skills.",
          "Release: pin the approved version and record an auditable decision.",
          "Observe: reconcile supported usage signals and identify drift or missing coverage."
        ]
      },
      {
        "id": "platforms",
        "heading": "What changes across ChatGPT, Claude, and Copilot?",
        "paragraphs": [
          "Different AI ecosystems expose different skill formats, administrative controls, and telemetry. A source-controlled skill version does not by itself guarantee native installation, synchronized edits, or full visibility into conversations.",
          "Keep the canonical artifact and approval evidence in one registry, then treat each provider as a distribution and observation adapter. Track supported capabilities separately: who can publish, who receives the skill, which version is installed, and what evidence can be collected."
        ],
        "bullets": [
          "Distinguish AI model API credentials from workspace administration and native skill publishing.",
          "Use provider-supported enterprise installation paths when available.",
          "Show integration coverage and unsupported states rather than assuming universal synchronization.",
          "Protect customer content and honor tenant-specific permissions for telemetry."
        ]
      },
      {
        "id": "selection",
        "heading": "What to look for in an AI skills platform",
        "paragraphs": [
          "A useful skills platform should answer four operational questions: which version is approved, why it was approved, where it is deployed, and what happens when it regresses. Search and discovery alone do not answer them.",
          "Savant combines a Git-backed registry with evaluations, approval workflows, release evidence, and a public catalog for assessing external skills. Before depending on a particular provider integration, verify the supported distribution method and collection permissions in your environment."
        ],
        "bullets": [
          "Prefer traceable source revisions over copied, unversioned prompts.",
          "Require reproducible evaluations and negative-case testing.",
          "Retain review and rollback controls for consequential changes.",
          "Evaluate identity, tenant isolation, and data-retention boundaries before connecting provider accounts."
        ]
      }
    ],
    "faq": [
      {
        "question": "What is the difference between an AI skill registry and a prompt library?",
        "answer": "A prompt library primarily stores reusable text. An AI skill registry also tracks source revisions, owners, dependencies, evaluations, approvals, and release state so changes can be governed as operational assets."
      },
      {
        "question": "Can a single platform manage skills for ChatGPT, Claude, and Microsoft Copilot?",
        "answer": "A common registry can govern skill source and review decisions, but native publishing and telemetry vary by provider, product tier, and administrative permissions. Verify supported adapters rather than assuming one-click synchronization everywhere."
      },
      {
        "question": "Do we have to move our skills out of Git?",
        "answer": "No. Savant is designed around Git as the source of skill content, with governance records and evaluation evidence associated with those source revisions."
      }
    ],
    "related": [
      {
        "path": "/ai-skill-evaluation",
        "label": "How to evaluate agent skills"
      },
      {
        "path": "/enterprise-ai-skill-governance",
        "label": "Enterprise governance model"
      },
      {
        "path": "/catalog",
        "label": "Explore the public skill catalog"
      }
    ]
  },
  {
    "path": "/ai-skill-evaluation",
    "title": "AI Skill Evaluation and Regression Testing",
    "description": "Evaluate AI agent skills before release with representative cases, rubrics, baseline comparisons, regression gates, and reviewable evidence.",
    "headline": "Evaluate AI agent skills before they reach production.",
    "eyebrow": "Guide / Evaluation engineering",
    "lede": "A skill that reads well is not necessarily a skill that works. Skill evaluation turns a proposed instruction change into measurable evidence, including what improved, what regressed, and whether the new version is safe to approve.",
    "published": "2026-10-25",
    "keywords": [
      "AI skill evaluation",
      "agent skill testing",
      "LLM regression testing",
      "AI agent evaluations",
      "prompt regression testing"
    ],
    "sections": [
      {
        "id": "definition",
        "heading": "What does an AI skill evaluation measure?",
        "paragraphs": [
          "AI skill evaluation measures whether a reusable agent instruction produces the intended behavior across representative tasks. It is broader than checking whether a response looks plausible. A good evaluation tests the output against a clear rubric, the workflow's constraints, and the risks of taking the wrong action.",
          "Because model outputs vary, results should be interpreted as evidence from a defined model, version, dataset, and evaluation configuration. They are not universal guarantees of future behavior."
        ],
        "bullets": [
          "Task success and answer quality for realistic cases.",
          "Grounding and policy adherence, including prohibited actions.",
          "Tool-use appropriateness and handoff correctness where observed.",
          "Latency, token use, and cost where reported by the execution provider."
        ]
      },
      {
        "id": "dataset",
        "heading": "Design a credible test set",
        "paragraphs": [
          "Start with real work patterns that can be sanitized and reproduced. Include ordinary requests, ambiguous inputs, adversarial instructions, and edge cases that previously caused failures. Define the expected outcome before evaluating a candidate to avoid changing the rubric to reward the result.",
          "Separate development examples from a holdout set so repeated tuning cannot simply memorize the evaluation. Pin datasets and skill revisions to make a comparison reproducible."
        ],
        "bullets": [
          "Positive cases: the skill completes its intended task.",
          "Negative cases: unauthorized or unsafe requests are rejected appropriately.",
          "Boundary cases: missing context, conflicting instructions, malformed inputs, and unavailable tools.",
          "Regression cases: past production failures become permanent checks.",
          "Holdout cases: withheld scenarios test generalization beyond the tuning set."
        ]
      },
      {
        "id": "compare",
        "heading": "Compare candidates against a known baseline",
        "paragraphs": [
          "Evaluate the currently approved version and the candidate under the same model, task mix, and scoring configuration. Report changes by dimension, not only a single blended score. A small average improvement may conceal a severe failure in a high-risk case.",
          "Keep the exact test inputs, model configuration, judge rationale, and observed run evidence when authorized. Judge-model scores should be calibrated against human review and deterministic assertions where possible; a model's self-reported confidence is not proof."
        ],
        "bullets": [
          "Use paired comparisons so cases and conditions remain equivalent.",
          "Distinguish observed model or tool traces from inferred or missing telemetry.",
          "Treat critical safety regressions as release blockers even when the aggregate score improves.",
          "Surface uncertainty when sample size, model drift, or judge reliability limits the conclusion."
        ]
      },
      {
        "id": "release",
        "heading": "Turn evaluation results into an approval gate",
        "paragraphs": [
          "Define thresholds before running the candidate. A release decision can combine rubric minimums, zero-tolerance failure categories, stability requirements, and a cost budget. Store the gate outcome with the source revision and reviewer decision.",
          "Savant's evaluation and release workflows are designed to make this evidence reviewable. A human remains responsible for approving a release; an optimization suggestion should never silently replace a production skill."
        ],
        "bullets": [
          "Pin the candidate and baseline to immutable source references.",
          "Capture a clear pass, fail, or insufficient-evidence decision.",
          "Block promotion on specified critical regressions.",
          "Record approval, distribution state, and a rollback path."
        ]
      }
    ],
    "faq": [
      {
        "question": "Is AI skill evaluation the same as security scanning?",
        "answer": "No. Security scanning looks for hazardous instructions, suspicious dependencies, or other known risks. Behavioral evaluation tests how a skill performs against representative tasks. Both are useful and neither replaces the other."
      },
      {
        "question": "Can an LLM judge other LLM outputs reliably?",
        "answer": "An LLM judge can scale rubric-based assessment, but it can be biased or inconsistent. Use clear rubrics, deterministic checks when possible, calibrated human review, and pinned evaluation conditions."
      },
      {
        "question": "How many cases are enough for a skill evaluation?",
        "answer": "There is no universal minimum. Choose cases based on task variability and failure impact, and increase coverage for consequential workflows. Track what the dataset does not test instead of inferring broad reliability from a small pass rate."
      }
    ],
    "related": [
      {
        "path": "/ai-agent-skill-management",
        "label": "AI agent skill management"
      },
      {
        "path": "/enterprise-ai-skill-governance",
        "label": "Governance and release controls"
      },
      {
        "path": "/docs",
        "label": "Savant getting-started documentation"
      }
    ]
  },
  {
    "path": "/enterprise-ai-skill-governance",
    "title": "Enterprise AI Skill Governance",
    "description": "A practical governance model for reusable AI skills: ownership, access, evidence, approval policies, audit, and provider-specific deployment boundaries.",
    "headline": "Govern reusable AI skills without losing control of change.",
    "eyebrow": "Guide / Enterprise controls",
    "lede": "As organizations adopt more AI assistants, reusable instructions and agent capabilities become a new form of operational software. Enterprise AI skill governance establishes who owns these assets, how changes are tested, and which approved versions people and agents may use.",
    "published": "2026-10-25",
    "keywords": [
      "enterprise AI skill governance",
      "AI agent governance platform",
      "managed enterprise skills",
      "AI skill access controls",
      "AI governance audit trail"
    ],
    "sections": [
      {
        "id": "scope",
        "heading": "What does enterprise AI skill governance cover?",
        "paragraphs": [
          "Skill governance applies software-style controls to reusable agent instructions and associated tools. It differs from general AI governance: rather than addressing every model risk, it focuses on the lifecycle and permitted use of organizational skills.",
          "The core control objective is traceability from an authorized source revision through evaluation, approval, release, and observed use. This creates evidence for internal assurance without claiming that a prompt alone can enforce runtime security."
        ],
        "bullets": [
          "Inventory, classification, ownership, and accountable reviewers.",
          "Role- and policy-based permissions for proposing, approving, and distributing changes.",
          "Evidence from evaluations and documented release decisions.",
          "Version pinning, drift detection where supported, and rollback procedures.",
          "Auditable changes with tenant boundaries and retention controls."
        ]
      },
      {
        "id": "roles",
        "heading": "Separate authoring, approval, and execution authority",
        "paragraphs": [
          "The people writing a skill should not automatically gain the ability to publish it across an enterprise. For high-impact capabilities, separate authors, evaluators, release approvers, and runtime administrators, even if a small team temporarily combines roles.",
          "Record the required evidence at each gate. A low-risk writing skill may need lightweight checks, while a skill that advises on security incidents or changes infrastructure needs stricter tests and explicit approval."
        ],
        "bullets": [
          "Define skill tiers by consequence of failure and scope of distribution.",
          "Grant least-privilege access to repositories, evaluation data, and provider connectors.",
          "Use review gates tied to exact source revisions and policy versions.",
          "Constrain agent tool permissions at runtime; a skill registry does not replace enforcement."
        ]
      },
      {
        "id": "architecture",
        "heading": "Use a governed registry and provider-specific adapters",
        "paragraphs": [
          "A practical architecture keeps the authoritative skill record, evaluations, and approvals in a control plane. External AI platforms remain responsible for their own native administration and inference. Distribution adapters publish approved artifacts through supported APIs or managed clients; observation adapters collect only permitted evidence.",
          "This separation avoids assuming that a single OAuth application can intercept all conversations, prevent every native edit, or synchronize every enterprise skill. Where a provider does not expose a needed interface, show incomplete coverage rather than silently filling the gap."
        ],
        "bullets": [
          "Preserve Git provenance and authorized review history.",
          "Treat model API keys, native publishing permissions, and compliance exports as distinct authorizations.",
          "Reconcile actual distribution state and report missing or stale versions.",
          "Respect provider coverage limits, tenant consent, privacy policy, and retention requirements."
        ]
      },
      {
        "id": "rollout",
        "heading": "Start with a bounded enterprise rollout",
        "paragraphs": [
          "Select a few representative team skills and establish a measurable baseline before broad distribution. Verify that a change can be evaluated, rejected, approved, and rolled back in practice. Then expand coverage to more teams and connected AI environments.",
          "Savant's control-plane approach is intended for this progression: central skill inventory, evaluation evidence, reviewer decisions, and explicit deployment state. Confirm the production readiness of each native integration separately before treating it as an enterprise-wide control."
        ],
        "bullets": [
          "Identify an accountable skill owner and one approved repository.",
          "Implement a release and rollback exercise using synthetic, non-sensitive work.",
          "Measure evaluation coverage, approval lead time, and version drift.",
          "Expand only after verifying tenant authorization, logging quality, and supported platform paths."
        ]
      }
    ],
    "faq": [
      {
        "question": "Does AI skill governance require routing all AI traffic through Savant?",
        "answer": "No. A governance control plane can own approved skill versions, evaluation evidence, and release decisions without proxying all inference traffic. Runtime controls and observation depend on the execution platform and chosen integration."
      },
      {
        "question": "Can governing a skill prevent prompt injection?",
        "answer": "Skill governance can reduce change risk and support testing, but it does not by itself prevent prompt injection at runtime. Authorization, tool boundaries, content controls, and monitoring must be enforced separately."
      },
      {
        "question": "How do enterprises know whether a distributed skill is current?",
        "answer": "Compare the approved source revision against version information reported by supported clients or provider APIs. If an environment does not expose version inventory, mark its deployment status as unverified instead of claiming that it is synchronized."
      }
    ],
    "related": [
      {
        "path": "/ai-agent-skill-management",
        "label": "Skill lifecycle and registry"
      },
      {
        "path": "/ai-skill-evaluation",
        "label": "Evaluation and regression testing"
      },
      {
        "path": "/security",
        "label": "Savant security architecture"
      }
    ]
  }
];

export function getSeoGuide(path: GuidePath): SeoGuide {
  const guide = SEO_GUIDES.find((item) => item.path === path);
  if (!guide) throw new Error("Unknown SEO guide: " + path);
  return guide;
}
