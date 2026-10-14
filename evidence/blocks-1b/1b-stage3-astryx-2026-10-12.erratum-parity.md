# Erratum: parity in the Astryx Stage-3 decision packet (2026-10-14)

## What was wrong
Sections 4.7 and 5.8 of `1b-stage3-astryx-2026-10-12.decision-packet.md` say that the parity checker's defect "lowers every arm's score alike". It does not.
- The defect was that the checker skipped every string held in an array, which is where Astryx tables keep their column labels and cells.
- aestheticfunction/dspack-studio#102, merged to main as `7e260c3`, corrected the reading.

## The recomputation
Recomputed offline over this run's committed `runs.jsonl`:
- with the harness's own `summarize()`;
- with each record's checklist rebuilt as `arms.ts` builds it. The old reading reproduces all 459 stored parity results this way.

| Arm | Mean, all, before | After | Gain | Full, all, before | After | Mean, fresh, before | After | Full, fresh, before | After |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| block | 0.828 | 0.963 | +13.5 | 75 / 113 | 105 / 113 | 0.875 | 1.000 | 18 / 24 | 24 / 24 |
| capped | 0.818 | 0.959 | +14.1 | 75 / 114 | 105 / 114 | 0.847 | 1.000 | 17 / 24 | 24 / 24 |
| production | 0.808 | 0.948 | +14.0 | 70 / 108 | 96 / 108 | 0.847 | 0.986 | 17 / 24 | 23 / 24 |
| block-positional | 0.780 | 0.963 | +18.3 | 65 / 105 | 99 / 105 | 0.826 | 1.000 | 16 / 23 | 23 / 23 |

The "before" columns are the packet's own table in section 4.7.

- **The gains differ.** Block-positional gains 18.3 points, against 13.5 to 14.1 for the others. It moves from the lowest score to level with the block arm: 0.9635 against 0.9631.
- **Section 4.7's comparison still holds.** The block arm scores at least as well as both primitive arms:
  - over all cells, 0.963 against 0.959 for capped and 0.948 for production;
  - over fresh cells, 1.000 against 1.000 and 0.986.
- **Nothing outside parity changes.** 48 summary fields differ, and all of them are parity's mean and full counts. These are byte-identical to the committed `summary.json`:
  - the decision, with its intervals;
  - the operation sensitivity;
  - selection;
  - the encoding comparison;
  - the totals.

## What stays as it is
The packet and the run directory are not edited. Their checksums still verify. This file is the correction.
