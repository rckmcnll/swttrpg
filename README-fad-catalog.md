# Force & Destiny catalog (`fad-catalog.js`)

`force-and-destiny-character-sheet.html` loads `fad-catalog.js` (via `<script src>`) to populate the
**Add specialization** / **Add Force power** pickers. The two files are a bundle — keep `fad-catalog.js`
next to the HTML. If it's missing, the sheet still works; the Add buttons just disable.

## What's in the catalog
`window.FAD_CATALOG` (schema `fad-catalog-v1`):
- **careers / specializations / forcePowers** — the Force & Destiny careers (ForceRating ≥ 1), the
  specializations they grant plus Universal specializations, and all Force powers — each as a stateless
  talent-tree template (`nodes` + `edges`) matching the sheet's runtime `state.trees` shape.
- **equipment** — `{ weapons, armor, gear }` keyed by item key, with row-ready fields (weapons:
  skill/dam/crit/range/enc/special incl. formatted qualities; armor: defense/soak/enc/hp; gear:
  enc/notes). Powers the **Lookup weapon / armor / gear** buttons on the sheet.

## Regenerating
The catalog is generated from an OggDude **Star Wars Character Generator** DataSet (XML) that you supply:

```
node tools/convert-catalog.mjs "<path-to>/SWCharGen/Data" fad-catalog.js
```

The converter is zero-dependency (no `npm install`). It prints validation counts and exits non-zero if any
talent/ability/edge fails to resolve. See `docs/multi-tree-catalog-spec.md` for the design.

## Item descriptions
The committed `fad-catalog.js` carries OggDude's page-reference stubs for descriptions (e.g. "see page
167…") — the full rulebook text is copyrighted and is **not** published here. Weapon qualities are explained
on the sheet via a built-in plain-language glossary (`QUALITY_GLOSSARY`, original wording) shown as a tooltip
on each weapon's *Special* field.

## Local full-description build (private, not committed)
If you have a dataset whose `<Description>` entries contain full text you have the right to use locally,
generate a **local override** that is gitignored and never published:

```
node tools/convert-catalog.mjs "<your-dataset>/Data" fad-catalog.local.js
```

The sheet loads `fad-catalog.local.js` after `fad-catalog.js`, so if it exists it transparently replaces the
catalog (descriptions and all); if it's absent the `<script>` 404s harmlessly and the public catalog is used.
`fad-catalog.local.js` is in `.gitignore` — keep it local.

## Licensing / fan content
This is an **unofficial fan tool**. *Star Wars* and *Force and Destiny* are trademarks of their respective
owners (Lucasfilm / Fantasy Flight Games / Edge Studio); this project is not affiliated with or endorsed by
them. The OggDude DataSet is **not** included in this repo (it's gitignored) — provide your own copy. The
generated `fad-catalog.js` contains only names, XP costs, and tree structure; ability/talent descriptions are
OggDude's page-reference stubs (e.g. "see page 152…"), not rulebook prose.
