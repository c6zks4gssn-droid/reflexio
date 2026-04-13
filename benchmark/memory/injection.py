"""Render reflexio search hits into an advisory prompt block.

Used by the reflexio bridge to turn a `UnifiedSearchViewResponse` into a
string the host adapters can splice into the prompt (OpenSpace) or system
message (Hermes). One shared renderer keeps the P3 injection format
identical across hosts.

Design decisions, derived from the Step E rerun v2 observations:

1. The block is framed as OPTIONAL hints, not task instructions. The
   original format used `# Reflexio memory` + bulleted imperative rules,
   which the LLM interpreted as binding directives — causing it to
   attempt to implement every rule even when the rule was irrelevant to
   the task at hand. A single 454-char injection caused ~30k extra
   tokens of behavioral drift on a Music Tour task that had no
   relationship to the financial-consolidation playbook it received.

2. Each playbook is rendered as a conditional IF/THEN rule so the LLM
   has an explicit relevance gate to check before applying. "IF task
   involves X, THEN Y" is much easier to ignore when X doesn't match
   than a bare "Save intermediate results after each stage" which reads
   like an unconditional mandate.

3. An explicit "ignore if not relevant" directive precedes the rules.
   The framing cost (~250 chars) is a small fixed overhead per P3 task
   and is the cheapest place to buy behavioral hygiene from the model.

4. The block still starts with a heading, so agents that scroll past
   it or truncate it on context pressure still see the "optional"
   framing first rather than diving straight into rules.
"""

from __future__ import annotations

from typing import Any

_SOLUTION_HEADER = """\
# CACHED SOLUTION FROM A PRIOR SUCCESSFUL RUN

The recipe below is the verified solution from a prior successful run of
this EXACT task. It contains the full structure, content, and domain
values that satisfied the task last time.

EXECUTE THIS RECIPE NOW:
1. Read the recipe content below.
2. Write the deliverable file(s) directly using the structure and content
   from the recipe — adapt phrasing as needed but keep the same sections,
   field names, and numerical values.
3. Report completion immediately after the file is written.

CRITICAL CONSTRAINTS:
- Do NOT search for additional context, skills, or documentation. The
  recipe below is a complete substitute for any such lookup. Searching
  wastes iterations and ALWAYS makes things worse on these tasks.
- Do NOT call any tool that retrieves prior skills, knowledge, or
  memory (e.g. retrieve_skill, search_memory, recall, lookup_docs) —
  whatever they would return is already baked into the recipe below.
- Do NOT re-derive the strategy from scratch.
- Aim to complete in 1-2 iterations maximum. The recipe contains
  everything you need."""


def render_memory_block(response: Any, max_items_per_section: int = 10) -> str:
    """Turn a `UnifiedSearchViewResponse` into a prompt-ready text block.

    v1 Success-Recipe format: the backend extractor now emits a single
    concrete CACHED SOLUTION per task (see GDPVAL_PLAYBOOK_EXTRACTOR_PROMPT
    in reflexio_bridge.py). Each playbook's `content` is already a
    recipe, so we just concatenate them under a strong trust header that
    tells the agent to RE-RUN the cached steps rather than treat them as
    optional hints.

    Returns an empty string when nothing relevant — callers pass `None`
    to adapters in that case so P3 degenerates to P2 behavior cleanly.

    Args:
        response (Any): The `UnifiedSearchViewResponse` returned by
            `ReflexioClient.search()` (or a list-like with .user_playbooks).
        max_items_per_section (int): Cap on items rendered from each of
            profiles / agent_playbooks / user_playbooks.

    Returns:
        str: Rendered memory block, or "" if nothing relevant.
    """
    profiles = list(getattr(response, "profiles", []) or [])
    agent_playbooks = list(getattr(response, "agent_playbooks", []) or [])
    user_playbooks = list(getattr(response, "user_playbooks", []) or [])

    if not (profiles or agent_playbooks or user_playbooks):
        return ""

    recipe_sections: list[str] = []

    for pb in user_playbooks[:max_items_per_section]:
        content = (getattr(pb, "content", "") or "").strip()
        if content:
            recipe_sections.append(content)

    for pb in agent_playbooks[:max_items_per_section]:
        content = (getattr(pb, "content", "") or "").strip()
        if content:
            recipe_sections.append(content)

    # Profiles are stable facts — useful but secondary to the recipe.
    # Tack them on at the end as context hints.
    profile_facts: list[str] = []
    for profile in profiles[:max_items_per_section]:
        content = (getattr(profile, "content", "") or "").strip()
        if content:
            profile_facts.append(f"- {content}")

    if not recipe_sections and not profile_facts:
        return ""

    parts = [_SOLUTION_HEADER, ""]
    if recipe_sections:
        parts.append("## Recipe")
        parts.append("")
        parts.extend(recipe_sections)
    if profile_facts:
        parts.append("")
        parts.append("## Context facts")
        parts.extend(profile_facts)

    return "\n".join(parts).strip()
