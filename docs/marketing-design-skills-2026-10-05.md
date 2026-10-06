# Marketing-page design skill shortlist

Research date: October 5, 2026. Recommendations only; no skills installed.

## Recommended combination

| Skill | Purpose for ServiceClerk | Source and adoption observed |
| --- | --- | --- |
| `anthropics/skills` → `frontend-design` | Distinctive visual direction and production frontend implementation: typography, layout, imagery, responsive composition, and motion | [Directory](https://skills.sh/anthropics/skills/frontend-design): approximately 954.5K installs and 179.6K repository stars |
| `coreyhaines31/marketingskills` → `cro` | Homepage and pricing-page structure: value proposition, CTA hierarchy, objections, trust, and conversion friction | [Current source](https://github.com/coreyhaines31/marketingskills/blob/main/skills/cro/SKILL.md); [older page-cro listing](https://skills.sh/coreyhaines31/marketingskills/page-cro): approximately 58.2K installs. Repository approximately 53K stars. The older listing count is not the current cro install count. |
| `coreyhaines31/marketingskills` → `copywriting` | Contractor-focused homepage and pricing copy, plan explanations, and clear purchase CTAs | [Directory](https://skills.sh/coreyhaines31/marketingskills/copywriting): approximately 215.8K installs and 53K repository stars |

Counts are directory observations and can change. Popularity is supporting evidence, not proof of quality or safety. The source instructions were also inspected. The marketing repository describes its author and purpose [here](https://github.com/coreyhaines31/marketingskills).

Suggested install commands, using current source skill names:

```powershell
npx skills add anthropics/skills --skill frontend-design
npx skills add coreyhaines31/marketingskills --skill cro --skill copywriting
```

The source now uses `cro`, not the old directory name `page-cro`. Do not blindly install from an old name. Inspect the selected revision and references before installation/use.

## How these complement the existing skills

Use frontend-design for the distinctive visual treatment; CRO for the page's sequence and decision-making; copywriting for the language. The existing interface-design and web-design-guidelines skills can still support consistency and usability. Existing CRO/copywriting plugin skills overlap with the two marketing recommendations, so installing both is optional; frontend-design is the clearest additional implementation capability.

Apply the skills to one coherent brief, rather than combining incompatible aesthetics. For ServiceClerk: an approachable professional tool for a solo contractor, centered on one real quote-to-payment workflow. Acquisition pages should make that workflow understandable. Account billing should prioritize cost clarity and user control.

For tomorrow's low-traffic launch, use direct observation of the tester completing tasks and asking what the price means. Recommendations for statistical A/B testing are not useful without sufficient traffic. Never use a skill's generic example statistics or social-proof patterns as claims about this app.

First improve factual correctness identified in the entitlement audit. Then create a shared visual direction for homepage, pricing, and trade landing pages, while preserving the simpler transactional character of account billing.
