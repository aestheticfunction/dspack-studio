# Live pilot summary

Runs completed: 12 of 12. Committed: $0.7507 over 80 requests (unverified reservations counted at their worst case). Served model: claude-haiku-4-5-20251001.


Governance compliance (the gates) and task fit (the checklists below, marked by a person) are separate results.

| Build | Planned intent | Outcome | First pass | Repairs | Tokens in/out | Cost | Latency ms | Wireframe components | Model |
|---|---|---|---|---|---|---|---|---|---|
| hotel-single-1 | transactional-review | passed | yes | 0 | 12788/2598 | $0.0271 | 44685 | none | claude-haiku-4-5-20251001 |
| hotel-single-2 | transactional-review | passed | yes | 0 | 12788/2350 | $0.0258 | 60398 | none | claude-haiku-4-5-20251001 |
| hotel-single-3 | transactional-review | passed | yes | 0 | 12788/2618 | $0.0272 | 63555 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 1 | data-collection | passed | yes | 0 | 12285/413 | $0.0151 | 60416 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 2 | record-collection | passed | yes | 0 | 12501/461 | $0.0155 | 63096 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 3 | transactional-review | passed | yes | 0 | 12716/1387 | $0.0206 | 65577 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 4 | structured-editing | passed | yes | 0 | 12256/803 | $0.0171 | 60435 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 5 | transactional-review | passed | no | 1 | 26476/2155 | $0.0391 | 92457 | none | claude-haiku-4-5-20251001 |
| hotel-flow-1 step 6 | destructive-action | passed | yes | 0 | 12142/227 | $0.0139 | 59341 | none | claude-haiku-4-5-20251001 |
| hotel-flow-2 step 1 | data-collection | passed | yes | 0 | 12295/588 | $0.0160 | 62358 | none | claude-haiku-4-5-20251001 |
| hotel-flow-2 step 2 | record-collection | passed | yes | 0 | 12517/486 | $0.0157 | 62800 | none | claude-haiku-4-5-20251001 |
| hotel-flow-2 step 3 | transactional-review | passed | yes | 0 | 12722/1165 | $0.0195 | 64909 | none | claude-haiku-4-5-20251001 |
| hotel-flow-2 step 4 | transactional-review | passed | yes | 0 | 12734/835 | $0.0178 | 60454 | none | claude-haiku-4-5-20251001 |
| hotel-flow-2 step 5 | data-collection | passed | yes | 0 | 12279/463 | $0.0153 | 60137 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 1 | data-collection | passed | yes | 0 | 12295/417 | $0.0151 | 60716 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 2 | record-collection | passed | yes | 0 | 12511/467 | $0.0156 | 63179 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 3 | transactional-review | passed | yes | 0 | 12744/1148 | $0.0194 | 65130 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 4 | transactional-review | passed | yes | 0 | 12722/1184 | $0.0196 | 61784 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 5 | structured-editing | passed | yes | 0 | 12272/1594 | $0.0213 | 64489 | none | claude-haiku-4-5-20251001 |
| hotel-flow-3 step 6 | destructive-action | passed | no | 1 | 24389/1265 | $0.0322 | 88135 | none | claude-haiku-4-5-20251001 |
| corpus-03-1 | structured-editing | passed | yes | 0 | 12540/2691 | $0.0273 | 72054 | none | claude-haiku-4-5-20251001 |
| corpus-03-2 | structured-editing | passed | yes | 0 | 12540/2194 | $0.0247 | 60390 | none | claude-haiku-4-5-20251001 |
| corpus-10-1 | record-collection | passed | no | 1 | 26907/2603 | $0.0419 | 84468 | none | claude-haiku-4-5-20251001 |
| corpus-10-2 | record-collection | passed | no | 1 | 26156/1584 | $0.0358 | 92266 | none | claude-haiku-4-5-20251001 |
| corpus-05-1 step 1 | record-collection | passed | no | 1 | 24960/857 | $0.0307 | 93463 | none | claude-haiku-4-5-20251001 |
| corpus-05-1 step 2 | data-collection | passed | yes | 0 | 12309/525 | $0.0157 | 61404 | none | claude-haiku-4-5-20251001 |
| corpus-05-1 step 3 | transactional-review | passed | yes | 0 | 12742/527 | $0.0161 | 62357 | none | claude-haiku-4-5-20251001 |
| corpus-05-1 step 4 | destructive-action | passed | yes | 0 | 12172/261 | $0.0142 | 60951 | none | claude-haiku-4-5-20251001 |
| corpus-05-1 step 5 | record-collection | passed | no | 1 | 24397/669 | $0.0291 | 93564 | none | claude-haiku-4-5-20251001 |
| corpus-05-2 step 1 | record-collection | passed | no | 1 | 25002/855 | $0.0307 | 92894 | none | claude-haiku-4-5-20251001 |
| corpus-05-2 step 2 | data-collection | passed | yes | 0 | 12305/564 | $0.0159 | 62356 | none | claude-haiku-4-5-20251001 |
| corpus-05-2 step 3 | transactional-review | passed | yes | 0 | 12736/558 | $0.0163 | 62067 | none | claude-haiku-4-5-20251001 |
| corpus-05-2 step 4 | destructive-action | passed | yes | 0 | 12170/244 | $0.0141 | 60636 | none | claude-haiku-4-5-20251001 |
| corpus-05-2 step 5 | structured-editing | passed | yes | 0 | 12278/819 | $0.0172 | 65303 | none | claude-haiku-4-5-20251001 |

## Task fit (to be marked by a person)

### hotel-single-1

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### hotel-single-2

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### hotel-single-3

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### hotel-flow-1 (flow plan: model, 6 steps)

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### hotel-flow-2 (flow plan: model, 5 steps)

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### hotel-flow-3 (flow plan: model, 6 steps)

- [ ] destination
- [ ] check-in date
- [ ] check-out date
- [ ] guest count
- [ ] a comparison of at least two hotels
- [ ] a room choice
- [ ] a review of the reservation
- [ ] an explicit confirmation

### corpus-03-1

- [ ] the estimate reference and status
- [ ] the line items or services estimated
- [ ] totals
- [ ] what the user can do next, as EXPECTED.md row 3 describes

### corpus-03-2

- [ ] the estimate reference and status
- [ ] the line items or services estimated
- [ ] totals
- [ ] what the user can do next, as EXPECTED.md row 3 describes

### corpus-10-1

- [ ] the filename and type
- [ ] the associated resource
- [ ] what the user can do with the file
- [ ] as EXPECTED.md row 10 describes (classified Partial)

### corpus-10-2

- [ ] the filename and type
- [ ] the associated resource
- [ ] what the user can do with the file
- [ ] as EXPECTED.md row 10 describes (classified Partial)

### corpus-05-1 (flow plan: model, 5 steps)

- [ ] a summary of the estimate being converted
- [ ] an explicit confirmation before the change
- [ ] the change cannot be repeated by accident
- [ ] a read-back of the result
- [ ] as EXPECTED.md row 5 describes

### corpus-05-2 (flow plan: model, 5 steps)

- [ ] a summary of the estimate being converted
- [ ] an explicit confirmation before the change
- [ ] the change cannot be repeated by accident
- [ ] a read-back of the result
- [ ] as EXPECTED.md row 5 describes

