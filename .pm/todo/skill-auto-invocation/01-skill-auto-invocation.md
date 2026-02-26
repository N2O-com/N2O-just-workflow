# Skill Auto-Invocation

**Status**: Not Started

---

## Scope

Make N2O skills fire automatically based on user intent, without requiring manual `/slash-command` invocation. This is about tuning what Claude Code's skill system already provides — better trigger descriptions, CLAUDE.md instructions for auto-invocation behavior, and config options — not building a separate routing layer.

**This spec covers**:
- Improved YAML frontmatter trigger descriptions for all 6 skills
- CLAUDE.md template instructions that guide auto-invocation behavior
- Config option to suppress/control auto-invocation per project
- Pattern skills (react-best-practices, web-design-guidelines) as ambient/passive linters
- Test harness to validate trigger matching works

**Out of scope**:
- Building a custom routing engine or middleware
- Skill versioning or A/B testing → `specs/n2o-roadmap.md` Goal 6
- Observability/logging of skill invocations → `specs/n2o-roadmap.md` Goal 7

---

## What's Done

| Item | Status |
|------|--------|
| YAML frontmatter with trigger descriptions | ⏳ Exists but needs improvement |
| detect-project auto-trigger in CLAUDE.md | ✅ Working proof of concept |
| Manual slash-command invocation | ✅ Working |
| Pattern skills as passive linters | ❌ Not started |
| Config option for auto-invocation | ❌ Not started |
| Test harness for trigger matching | ❌ Not started |

---

## Design

### 1. Improved Trigger Descriptions (YAML Frontmatter)

Claude Code uses the `description` field in YAML frontmatter to decide when to auto-invoke a skill. The current descriptions are functional but could be more effective:

**Problems with current descriptions:**
- Mix of "what it does" with "when to trigger" — Claude Code needs a clear signal
- Trigger phrases are tacked onto the end after "Triggers:"
- Pattern skills lack strong trigger signals for ambient use
- Some descriptions are too verbose (bug-workflow) or too terse (web-design-guidelines)

**Improvement strategy:**
- Lead with trigger intent, not capability description
- Include both explicit triggers ("I found a bug") and contextual triggers ("when debugging", "when investigating errors")
- Add negative signals for skills that should NOT fire (e.g., tdd-agent should not fire for planning questions)
- Pattern skills need "ambient" signals — fire when relevant code is being written/reviewed

### 2. CLAUDE.md Auto-Invocation Instructions

The CLAUDE.md template already has an agent instruction for detect-project. Extend this pattern to cover all skills:

**Agent instruction block** in templates/CLAUDE.md that tells Claude:
- Which skills are available and when they should fire
- That pattern skills should be consulted passively during relevant work
- How to handle multiple applicable skills (run them — prefer false positives)
- That users can suppress auto-invocation via config

### 3. Config Option

Add `auto_invoke_skills` to `.pm/config.json`:

```json
{
  "auto_invoke_skills": true,
  "disabled_skills": []
}
```

- `auto_invoke_skills`: Master toggle (default: true). When false, skills only fire via slash commands.
- `disabled_skills`: Array of skill names to exclude from auto-invocation (e.g., `["web-design-guidelines"]` for a CLI project with no UI).

The CLAUDE.md agent instruction reads this config and respects it.

### 4. Pattern Skills as Ambient Linters

Pattern skills (react-best-practices, web-design-guidelines) should behave differently from agent skills:

| Behavior | Agent Skills | Pattern Skills |
|----------|-------------|----------------|
| Invocation | On explicit intent ("I found a bug") | Passively during relevant work |
| Output | Full workflow (phases, database updates) | Brief guidance or warnings |
| Scope | Takes over the conversation | Adds context without disrupting flow |
| Multiple | Usually one at a time | Can layer with agent skills |

The CLAUDE.md instruction should tell Claude to consult pattern skills as reference material when writing/reviewing relevant code, without requiring the full skill workflow.

### 5. Test Harness

A test script that validates trigger matching by:
1. Simulating user messages (e.g., "I found a bug in the login flow")
2. Checking that the right skill(s) would be matched based on trigger descriptions
3. Verifying negative cases (planning questions don't trigger tdd-agent)
4. Verifying config suppression works

This is a shell script that exercises the YAML parsing and matching logic.

---

## Suggested Tasks

| # | Task | Done When |
|---|------|-----------|
| 1 | Rewrite YAML frontmatter trigger descriptions for all 6 skills | All skills have improved descriptions with clear triggers, contextual signals, and negative signals; lint-skills.sh still passes |
| 2 | Add auto-invocation instructions to CLAUDE.md template + config option | templates/CLAUDE.md has agent instruction block for skill auto-invocation; templates/config.json has auto_invoke_skills field; n2o init scaffolds correctly |
| 3 | Test harness for trigger matching + E2E validation | tests/test-n2o-skills.sh validates trigger descriptions parse correctly, config suppression works, and n2o init/sync preserve the new config fields |

---

## References

- Roadmap: `specs/n2o-roadmap.md` Goal 2 (Best Tooling Always)
- Existing proof of concept: detect-project auto-trigger in templates/CLAUDE.md
- Claude Code skill system: uses YAML `description` field for matching
