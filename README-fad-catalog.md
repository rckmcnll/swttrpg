# Force & Destiny catalog (`fad-catalog.js`)

`force-and-destiny-character-sheet.html` loads `fad-catalog.js` (via `<script src>`) to populate the
**Add specialization** / **Add Force power** pickers. The two files are a bundle — keep `fad-catalog.js`
next to the HTML. If it's missing, the sheet still works; the Add buttons just disable.

## What's in the catalog
`window.FAD_CATALOG` (schema `fad-catalog-v1`): the Force & Destiny careers (ForceRating ≥ 1), the
specializations they grant plus Universal specializations, and all Force powers — each as a stateless
talent-tree template (`nodes` + `edges`) matching the sheet's runtime `state.trees` shape.

## Regenerating
The catalog is generated from an OggDude **Star Wars Character Generator** DataSet (XML) that you supply:

```
node tools/convert-catalog.mjs "<path-to>/SWCharGen/Data" fad-catalog.js
```

The converter is zero-dependency (no `npm install`). It prints validation counts and exits non-zero if any
talent/ability/edge fails to resolve. See `docs/multi-tree-catalog-spec.md` for the design.

## Licensing / fan content
This is an **unofficial fan tool**. *Star Wars* and *Force and Destiny* are trademarks of their respective
owners (Lucasfilm / Fantasy Flight Games / Edge Studio); this project is not affiliated with or endorsed by
them. The OggDude DataSet is **not** included in this repo (it's gitignored) — provide your own copy. The
generated `fad-catalog.js` contains only names, XP costs, and tree structure; ability/talent descriptions are
OggDude's page-reference stubs (e.g. "see page 152…"), not rulebook prose.
