---
name: vault
description: Read and write the LV knowledge vault at C:\Users\Gary\luckyvault\LV-Vault — the Obsidian folder holding LV's rules, decisions, traps, systems, incidents and open items. Use it before answering "has this been decided before / is this a known trap / why is this number like that", and after any investigation, fix, or decision that produced knowledge a future session would otherwise have to rediscover.
---

# LV Vault

`C:\Users\Gary\luckyvault\LV-Vault` — an Obsidian vault. Plain markdown with
`[[wikilinks]]`; no plugin or app needed to read or write it.

## Read it BEFORE you work, not just after

The vault exists because `CLAUDE.md` is 1,382 lines that can only be read
top-to-bottom, so hard-won facts get buried and the same ground gets re-covered.
Before you investigate anything, grep the vault:

```
Grep pattern="<the thing>" path="C:/Users/Gary/luckyvault/LV-Vault" output_mode="content" -C=3
```

Start from `00 Index.md`. Five cards explain most of what goes wrong here:
`铁律 一件是什么`, `坑 一列两个意思`, `坑 查询失败不等于零`,
`坑 结案要写给消费方看`, `铁律 盘点`.

## Seven note types, and nothing else

| Folder | Holds | Expires? |
|---|---|---|
| `Rules/` | 铁律 — always applies, no exceptions, only Gary changes them | never |
| `Decisions/` | what Gary decided, with the date and his words | superseded by a newer one, which must say so |
| `Traps/` | mistakes that recur — the failure mode, not the incident | never (keep even once fixed; note when) |
| `Systems/` | one pipeline: what it does, where the code is, how it breaks | tracks the code |
| `Incidents/` | dated events: what happened, why, what changed | never — history is not edited |
| `Open/` | one unfinished thing per card | delete or mark done when finished |
| `Entities/` | people, rooms, accounts — link targets for everything else | tracks reality |

## Writing a card

Frontmatter, then a `#` title that IS the thing (not a category):

```markdown
---
type: rule | decision | trap | system | incident | open | entity
date: 2026-09-02          # incidents/decisions
opened: 2026-09-02        # open items
owner: Gary | Claude | 要问店里
money: 5062               # open items, when it is quantified — lets them be ranked
locked: true              # rules only
---
```

Rules that make the cards worth having:

1. **One card, one thing.** If the title needs "and", split it.
2. **Link generously.** `[[像这样]]` whenever you mention something with its own
   card. A link to a card that does not exist yet is a *feature* — it marks what
   should be written. Not an error.
3. **Every number carries its provenance and date.** "八月门店 $48,929(09-01 逐日
   重算,对收银台 +3.8%)" is usable. "门店大概五万" is not.
4. **Write the failure, not just the fix.** The reusable part is how it fooled
   us, not which line changed.
5. **Record your own wrong turns.** The 15x `sale_price` misread and the
   `notes`/`sale_notes` mixup are in the vault because the next person will make
   them too.

## What does NOT go in

Code, git history, anything a file read would tell you. The vault holds only what
you **cannot** recover by reading the repo: why a thing was decided, how it broke
last time, which numbers cannot be trusted, what a column actually means.

## When to write

- **Investigation that changed your mind about a number** → `Incidents/`, and if
  the mechanism generalizes, also a `Traps/` card
- **Gary decided something** → `Decisions/`, quote him, date it
- **You touched a pipeline** → update its `Systems/` card, especially the
  "known traps" part
- **Something is left undone** → `Open/`, with `owner` and `money` if known
- **You were bitten by something that will bite again** → `Traps/`

Do this in the same turn as the work. A finding written down tomorrow is a
finding lost.

## Verify after batch writes

Never author `.md` through a bash heredoc — see `Traps/坑 heredoc 吃反斜杠.md`,
which was itself corrupted that way while being written. Use Write/Edit, or write
a `.py` file and run it. Then scan:

```python
for p in glob.glob('**/*.md', recursive=True):
    s = open(p, encoding='utf-8').read()
    assert chr(8) not in s and chr(0) not in s and s.strip()
```

## Relationship to the other stores

- **`CLAUDE.md`** is still the auto-loaded session brief and is still authoritative.
  The vault is its navigable form. Whether CLAUDE.md shrinks to an index is Gary's
  call and has **not** been made — so for now, significant findings go in **both**.
- **`~/.claude/projects/.../memory/`** already uses `[[wikilinks]]`; new memories
  belong in the vault.
- The vault is its own git repo — commit when you write, so there is history.
