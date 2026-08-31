# Crafting Claude prompt actions

A *prompt action* is a small **✶ Claude** button attached to an actionable or technical
item. Hovering previews the exact prompt; clicking copies it to the clipboard so the
reader can paste it straight into Claude Code (or claude.ai) and act on that item.

## What counts as "actionable / technical"

Attach a button to items where a reader would plausibly want Claude to *do* or *explain*
something. Examples:

- A step, task, TODO, or checklist item ("Set up the port registry").
- A command, config snippet, API call, or code block.
- A named technique, algorithm, or pattern the reader might want implemented or expanded.
- A diagnostic/troubleshooting item ("If the build fails with X…").
- A design decision the reader might want to explore alternatives for.

Do **not** attach buttons to prose, definitions, or purely narrative passages. Aim for
signal over noise — a button on every paragraph is worse than none.

## Writing the prompt itself

The prompt is what gets pasted into Claude, so make it **self-contained and ready to run**:

1. Start with an imperative verb ("Implement…", "Explain…", "Generate…", "Debug…").
2. Inline the relevant context from the item — file names, commands, constraints, the
   surrounding section's intent — because the reader's Claude has none of this document's
   context.
3. State the desired output shape ("…and show me the diff", "…as a step-by-step list").
4. Keep it tight: 1–5 sentences. Multi-line is fine (see the JSON contract below).

**Good:** `Implement a deterministic port registry for all repos under ~/Projects: scan each repo for bound ports, write a single portRegistry.md source of truth, and generate a reassignment agent for each collision. Show me the plan before editing anything.`

**Weak:** `Help with the port registry.` (no context, not runnable as-is.)

## HTML output — markup contract

Each button references its prompt **by id** so multi-line prompts never need attribute
escaping. Put the actual prompt text in the `#cl-prompts` JSON block (the assembler
embeds it; `enrich.js` reads it).

Button, inline right after the item it acts on:

```html
<button class="cl-claude-btn" data-prompt-id="p-port-registry"
        aria-label="Copy Claude prompt: set up port registry">
  <span class="cl-claude-mark">✶</span><span class="cl-claude-label">Claude</span>
</button>
```

Prompts file passed to `assemble_html.py --prompts prompts.json` (ids must match):

```json
{
  "p-port-registry": "Implement a deterministic port registry for all repos under ~/Projects: scan each repo for bound ports, write a single portRegistry.md source of truth, and generate a reassignment agent for each collision. Show me the plan before editing anything."
}
```

`enrich.js` handles hover-preview, focus-preview, click/Enter/Space-to-copy, the
"Copied ✓" confirmation, and a `navigator.clipboard` → `execCommand` fallback for
`file://` contexts. You only have to emit the buttons and the JSON.

(For a tiny doc you may instead inline the prompt with `data-prompt="…"`, but then YOU
own attribute-escaping `"`/`<`/`&`/newlines. Prefer the id+JSON path.)

## Markdown output — graceful degradation

Markdown has no hover or JS, so a button can't preview-on-hover or copy-on-click. Degrade
to a `<details>` block whose code fence is copyable via the host's built-in code-block
copy button (works on GitHub):

```markdown
<details><summary>✶ Claude — set up the port registry</summary>

​```text
Implement a deterministic port registry for all repos under ~/Projects: scan each repo
for bound ports, write a single portRegistry.md source of truth, and generate a
reassignment agent for each collision. Show me the plan before editing anything.
​```

</details>
```

State this degradation in the closeout so the reader knows the hover-preview/one-click
copy is an HTML-only capability.
