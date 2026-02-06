# Why This Workflow Matters

## Strategic Value for N2O

1. **Compounding returns across the organization.** A 10% efficiency gain compounds across every engineer, every project, every sprint. We can push workflow improvements quickly across our entire team.

2. **$50k+ of value to every Cannon on Day 1.** We hand new engineers this system and make them 2x+ more effective per hour. They show up to their first engagement outperforming peers. Winners win. Better outcomes reflect on N2O and attract more talent.

3. **Customer-facing asset.** Lead magnet, expertise demonstration, potential consulting offering. Shows we're not another body shop—we have institutional knowledge about 4-5x developer output.

## The Core Insight

> "If Claude makes any decision as a developer, I want to know what decision it is. And I want 95% of those decisions to already be documented in the codebase. And wherever it makes those 5% of other decisions due to a new application, I want to review what decision it made and document it for the future."

This is **context management at scale**. Every pattern documented means less time debugging, less time reviewing, and more time shipping.

## Cost Model

| Metric | Value |
|--------|-------|
| Monthly cost | $400 (2x Claude Max subscriptions) |
| Productivity gain | 4-5x vs. pre-LLM baseline |
| Subscription vs API savings | 5x cheaper |
| Sprint cycle | ~2 days |

> "If you pay for $200 a month plan, that's equivalent to $1,000 of API."

## When to Create a New Pattern

A typical app has **50-250 patterns**. Not more, even in a large codebase. You should understand all of them.

### Codify When:

| Criteria | Example |
|----------|---------|
| **Reusable** (3+ future tasks) | "Mock TanStack Query hooks in component tests" |
| **Non-obvious** | "Test React Server Components with async data" |
| **Framework-specific** | "Zustand store with localStorage persistence" |
| **Architectural** | "RLS policy pattern for company-scoped data" |
| **Error-prone** | Common gotchas others will hit |

### Do NOT Codify When:

| Criteria | Example |
|----------|---------|
| **One-off** | Specific to single feature |
| **Trivial** | "Use ESLint", "add error handling" |
| **Library docs** | "PapaParse has a streaming mode" |
| **Too specific** | "Escape pipes in markdown tables for CSV preview" |
| **Implementation detail** | Business logic, not reusable pattern |

### Pattern Format (10-30 lines max)
````markdown
### [Pattern Name] (Task #ID)

**Problem**: What problem does this solve?

**Solution**: Brief explanation

**Pattern**:
```typescript
// One clear example
```

**When to use**: Conditions/scenarios
````

> **Rule of thumb**: If you debate whether to codify for >1 minute, skip it. Truly valuable patterns are obvious.

See `02-agents/tdd-agent/codify/antipatterns.md` for detailed examples of what NOT to document.

## Gaps & Roadmap

### Currently Missing

| Component | Description | Priority |
|-----------|-------------|----------|
| **Storybook Visual Workflow** | Screenshot-based visual iteration for UI components | High |
| **Playwright Screenshot Scripts** | Automated visual capture for debugging | High |
| **Stack-Specific Patterns** | Zustand, TanStack Query, shadcn patterns (project-specific) | Medium |
| **Terminal Configuration** | Keybindings for 10-window parallel workflow | Low |

### Adaptation Questions

- How do we adapt for multi-engineer teams? (pattern sharing, conflict avoidance)
- How do we handle different tech stacks? (separate pattern docs per stack)
- What's the onboarding path for a new engineer? (learning curve)

## Contributing

This is a core competency. We are investing heavily in improving these workflows.

### Adding Patterns

When you discover a reusable pattern during implementation:

1. Apply the criteria above (reusable, non-obvious, framework-specific)
2. Add to the appropriate skill file (10-30 lines per pattern)
3. Include: Problem, Solution, When to Use, Example

### Improving Workflows

When you find friction in the workflow:

1. Document the issue in `.wm/`
2. Propose a change to the relevant SKILL.md
3. Test the change over 2-3 sprints
4. Merge if it improves velocity
