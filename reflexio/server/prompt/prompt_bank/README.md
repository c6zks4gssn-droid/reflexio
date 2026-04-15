# prompt_bank

File-based versioned prompt templates for LLM operations.

> Part of the [Reflexio Server](../../README.md). See also the [Playbook Service](../../services/playbook/README.md) for prompt usage in playbook extraction.

## Main Entry Points

- **Manager**: `../prompt_manager.py` — `PromptManager`
- **Templates**: Each subdirectory is a `prompt_id`

## Directory Structure

```
prompt_bank/
├── README.md
├── playbook_aggregation/
│   ├── v1.0.0.prompt.md
│   ├── v1.1.0.prompt.md
│   └── v2.1.0.prompt.md      ← active: true in frontmatter
├── query_reformulation/
│   └── v1.0.0.prompt.md      ← active: true (only version)
└── ...
```

## File Format

Each `.prompt.md` file is self-contained with YAML frontmatter:

```markdown
---
active: true
description: "What this prompt does"
changelog: "Why this version was created"
variables:
  - var1
  - var2
---

Your prompt content with {var1} and {var2} placeholders.
```

### Frontmatter Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `active` | bool | No | `true` on the active version. Exactly one per prompt_id |
| `description` | string | No | What this prompt does. Include on all versions for context |
| `changelog` | string | No | Why this version was created — what changed from the previous version |
| `variables` | list[str] | Yes | Required template variables for validation |

## Usage

```python
# Access via request_context
rendered = request_context.prompt_manager.render_prompt(
    "profile_update_main",
    {"variable1": "value1", "variable2": "value2"}
)
```

## Adding a New Prompt

1. Create directory: `mkdir prompt_bank/my_new_prompt/`
2. Create `v1.0.0.prompt.md` with frontmatter and `{variable}` placeholders
3. Set `active: true` in frontmatter

## Version Naming Convention

File names: `v{MAJOR}.{MINOR}.{PATCH}.prompt.md`

- **MAJOR**: Breaking changes that introduce a different set of variables
- **MINOR**: Significant updates without changing variables
- **PATCH**: Minor tweaks to prompt content

## Deactivating a Prompt Version

When creating a replacement version, deactivate the old version by **removing** the `active: true` line from its frontmatter. Do NOT add `active: false` — simply omit the field. Prompts without the `active` field default to `active: false` (see `prompt_manager.py` line 211: `meta.get("active", False)`). Only the new replacement version should have `active: true`.

**Before** (old version `v1.0.0.prompt.md`):
```yaml
---
active: true
description: "Original prompt"
variables:
  - var1
---
```

**After** (old version `v1.0.0.prompt.md` — `active` line removed):
```yaml
---
description: "Original prompt"
variables:
  - var1
---
```

**New version** (`v2.0.0.prompt.md`):
```yaml
---
active: true
description: "Improved prompt"
changelog: "Replaced v1.0.0 with better instructions"
variables:
  - var1
---
```

## Key Rules

- **Prompt ID** = Directory name
- **Variables** use `{variable_name}` syntax in prompt body
- **Exactly one** version per prompt must have `active: true`
- **Deactivate old versions** by removing the `active: true` line — never add `active: false`
- **NEVER hardcode prompts** — always use `PromptManager`

## See Also

- [Server README](../../README.md) -- FastAPI backend component overview
- [Playbook Service README](../../services/playbook/README.md) -- how prompts are used in playbook extraction and aggregation
