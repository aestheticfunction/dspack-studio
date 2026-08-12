# @dspack-studio/fonts

The Aesthetic Function type set, committed as `.woff2` files.

## Why this package exists

`apps/web` and `apps/composer` used to declare their type with `next/font/google`.
Next self-hosts the result, so nothing was fetched at *runtime* — but the **build**
downloaded every face from `fonts.gstatic.com`, which made every build, every CI
run and every deploy depend on a third-party CDN being up. When it hiccuped the
build did not degrade, it failed:

```
[Error: Failed to fetch font file from `https://fonts.gstatic.com/s/ibmplexsans/...woff2`.]
An error occurred in `next/font`.
> Build failed because of webpack errors
```

Both apps now declare the same faces with `next/font/local`, pointed at the files
in `./files`. The bytes are in git, so a build needs no network for type at all.

## What is here

Six faces, 90.5 KB total, `latin` subset:

| File | Family | Weights | Bytes |
| --- | --- | ---: | ---: |
| `oswald-600-latin.woff2` | Oswald 4.103 | 600 | 12,776 |
| `ibm-plex-sans-variable-latin.woff2` | IBM Plex Sans 3.201 | 400 / 500 / 600 | 40,240 |
| `ibm-plex-mono-400-latin.woff2` | IBM Plex Mono 2.3 | 400 | 10,052 |
| `ibm-plex-mono-500-latin.woff2` | IBM Plex Mono 2.3 | 500 | 10,060 |
| `ibm-plex-mono-600-latin.woff2` | IBM Plex Mono 2.3 | 600 | 10,120 |
| `jost-400-latin.woff2` | Jost 3.710 | 400 | 9,404 |

IBM Plex Sans is a variable font with a `wght 100..700` axis, so one file serves
all three weights — the same single file Google served for all three before.

`catalog.json` pins each file by sha256. `node verify.mjs` re-checks every one of
them offline, and runs as this package's `test` script, so `pnpm test` covers it.

## Source and provenance

These are **the exact bytes `next/font/google` was already downloading** for this
repo — lifted from the `_next/static/media` output of a build on `main`
(`2c97210`), not re-exported or re-subset from somewhere else. That is deliberate:
it makes "no visual change" true by construction rather than by inspection. Same
files, same weights, same `font-display`, same CSS variable names.

Independent corroboration: all eight IBM Plex latin and latin-ext faces Google
served this repo are byte-identical (sha256) to the files vendored in the
`af-site` brand repo, which pins its own roster against the `google/fonts` `ofl/`
tree. The four IBM Plex faces used here are among them — two repos arrived at the
same bytes by different routes.

Oswald and Jost do **not** match af-site byte for byte, and should not: both are
variable fonts upstream, and `next/font/google` asked Google to pin the axis to
the one weight this product uses (`Oswald:wght@600`, `Jost:wght@400`), which
yields a smaller static instance than the axis-preserving file af-site vendors.
Same family, same version, same rendered weight.

## Subset

`latin` only, matching the `subsets: ["latin"]` the apps have always declared.

`next/font/google` emits `@font-face` rules for *every* subset Google returns and
only **preloads** the declared ones, so builds on `main` shipped 29 files (adding
latin-ext, greek, cyrillic, cyrillic-ext, vietnamese) of which these same 6 were
the preloaded latin set. Dropping the other 23 is safe here and was checked, not
assumed: a scan of `apps/`, `packages/`, `e2e/`, `acceptance/` and the demo project
found **zero** codepoints in the latin-ext, Greek, Cyrillic or Vietnamese ranges.
The only non-ASCII characters the product renders are arrows and marks
(`←`, `→`, `✓`, `✗`, `↳`, …) which fall outside *every* subset Google served, so
they resolved to the system stack before this change and still do.

Note the practical edge: `latin` covers `U+0000–U+00FF`, so all of the Western
European accented letters (`é à ö ñ ç ü …`) render in the brand faces. Text a user
authors in Polish, Czech, Turkish, Baltic or Vietnamese uses `latin-ext`
codepoints and will fall back to the system stack — as it did before for anything
beyond that, and as `af-site` also accepts by contract. If that ever needs to
change, add the latin-ext faces here and give each family its own `unicode-range`;
`next/font/local` applies `declarations` to every `src` entry in a call, so a
second subset needs either a merged file or a separate call per subset.

## Licensing

All four families are SIL Open Font License 1.1. This is not taken on trust —
each vendored binary declares it in its own `licenseURL` name record:

| Family | `licenseURL` |
| --- | --- |
| Oswald | `https://scripts.sil.org/OFL` |
| IBM Plex Sans | `http://scripts.sil.org/OFL` |
| IBM Plex Mono | `http://scripts.sil.org/OFL` |
| Jost | `http://scripts.sil.org/OFL` |

`OFL.txt` carries the full license text and each family's copyright notice, as
OFL 1.1 clause 2 requires of a redistribution. Copyright lines there are quoted
verbatim from the `copyright` name record of the vendored files.

To re-read those records from the binaries:

```js
import fontkit from "fontkit";
const font = fontkit.openSync("files/oswald-600-latin.woff2");
console.log(font.copyright, font.name.records.licenseURL);
```

## Changing the type set

Don't do it here alone. These faces mirror `af-site/assets/af.css`, which is the
brand source of truth for Aesthetic Function type. Change that first, then bring
the files across and re-run `node verify.mjs` after updating `catalog.json`.
