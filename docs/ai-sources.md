# AI guidance provenance

Reviewed on 2026-09-17 for ARC's Java 21/Spring Boot/JDBC backend and React/TypeScript/Vite/MUI frontend. The project guidance and workflows are written for ARC; upstream repositories provide selected design ideas and review criteria. The referenced scripts, hooks, code examples and complete skill bundles are not packaged here.

## Pinned references

| Source | Reviewed version and documents | Used for | Adaptation |
| --- | --- | --- | --- |
| GitHub Awesome Copilot | Commit `0a66795706fffe0a2fb99a7eb1af5f9b67c6db8d`: [Spring Boot](https://github.com/github/awesome-copilot/blob/0a66795706fffe0a2fb99a7eb1af5f9b67c6db8d/instructions/springboot.instructions.md), [code review](https://github.com/github/awesome-copilot/blob/0a66795706fffe0a2fb99a7eb1af5f9b67c6db8d/instructions/code-review-generic.instructions.md) | Constructor injection, focused services, evidence-based review | Preserve ARC JDBC and structured errors. Replace blanket method-length rules with responsibility and change-cost criteria. |
| ECC | Commit `dd6ee538aee0f548d4a6b520118f875431fd749e`: [Java standards](https://github.com/affaan-m/ECC/blob/dd6ee538aee0f548d4a6b520118f875431fd749e/skills/java-coding-standards/SKILL.md), [Spring Boot patterns](https://github.com/affaan-m/ECC/blob/dd6ee538aee0f548d4a6b520118f875431fd749e/skills/springboot-patterns/SKILL.md) | Explicit dependencies, immutable values, service transactions, observable failures | Apply the existing repository ports and per-execution state. Exclude Quarkus/JPA-specific conventions, generic retry/caching recipes and unrelated infrastructure. |
| Vercel Agent Skills | Commit `063bee94c3f4df8453406c830b0a7df0f2860278`: [React best practices](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices/SKILL.md), [composition patterns](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/composition-patterns/SKILL.md) | State ownership, composition, request lifecycles, optional-feature loading | Apply to a Vite client and existing MUI controls. Omit Next.js/RSC/server-action guidance. Require evidence for memoization and preserve current Hook contracts. |

GitHub's referenced repository uses the [MIT license](https://github.com/github/awesome-copilot/blob/0a66795706fffe0a2fb99a7eb1af5f9b67c6db8d/LICENSE), attributed to GitHub, Inc. ECC uses the [MIT license](https://github.com/affaan-m/ECC/blob/dd6ee538aee0f548d4a6b520118f875431fd749e/LICENSE), copyright 2026 Affaan Mustafa. The two referenced Vercel skill files declare `license: MIT` and `author: vercel` in their frontmatter. These statements identify upstream references; they do not assign a new license to ARC.

Awesome CursorRules was considered as a template catalog. Its overlapping stack preferences were not added as another active instruction layer. Popularity was used for discovery, not as evidence that every rule is correct or suitable for ARC.

## Runtime format references

- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills): repository discovery, required `SKILL.md` metadata, and invocation.
- [OpenAI: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): directory scope and instruction loading.

Local skills use `.agents/skills/<name>/SKILL.md` with optional `agents/openai.yaml` UI metadata. They retain normal implicit selection and explicit `$skill-name` invocation. No global model, tool, permission or agent configuration is changed by this collection.

## Updating the curation

Review the upstream diff against the pinned commit and write down the relevant change. Check it against ARC's contracts and tool versions before editing project guidance. Keep the existing project convention when an upstream example assumes a different framework, transport, storage model or deployment target. Update the reviewed commit only when the referenced material has actually been inspected.

The full graph contract and module boundaries remain in [architecture](architecture.md) and [maintenance](maintaining.md); they are not duplicated as an imported framework's rules.
