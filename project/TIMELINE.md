# Timeline and capacity

Estimates are relative to the start of feasibility. One engineer-day is eight hours. Base ticket estimates include design, implementation, documentation, review and verification. The estimates assume two physical test devices, representative networks, a supported device/browser matrix agreed in M0 and access to a suitable Pages test deployment. Access and availability are inputs to confirm.

| Scenario | Scheduled capacity | Effective planned work |
| --- | --- | --- |
| Individual developer | One engineer, 40 hours/week | 32 hours/week (4 engineer-days) after interruptions and coordination |
| Small team | Three engineers, 40 hours each/week | 80 hours/week (10 engineer-days) after planning, shared integration and coordination |
| Accelerated AI-assisted | One lead at 40 hours/week and one reviewer at 16 hours/week, with agents drafting bounded changes and fixtures | 48 effective hours/week (6 engineer-days), conditional on review throughput. Humans still own decisions, integration, debugging, physical-device and release verification. |

## Through the hackathon-ready release

Values in the last three columns are elapsed weeks in **optimistic / expected / conservative** order. The estimate scales both base effort and dependency-chain duration by 0.8 / 1.0 / 1.35. For each case, take the greater of scaled cumulative effort divided by weekly capacity or the scaled chain at five working days per week, then round up. These are planning ranges with no dated delivery commitment.

| Gate | Stage effort | Cumulative effort | Dependency floor | Solo | Small team | AI-assisted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M0 | 28 d | 28 d | 11 d | 6 / 7 / 10 | 3 / 3 / 4 | 4 / 5 / 7 |
| M1 | 35 d | 63 d | 29 d | 13 / 16 / 22 | 6 / 7 / 9 | 9 / 11 / 15 |
| M2 | 36 d | 99 d | 40 d | 20 / 25 / 34 | 8 / 10 / 14 | 14 / 17 / 23 |
| M3 | 37 d | 136 d | 51 d | 28 / 34 / 46 | 11 / 14 / 19 | 19 / 23 / 31 |

```mermaid
flowchart LR
    Start["Start feasibility"] --> M0["M0 · week 3"]
    M0 --> M1["M1 · week 7"]
    M1 --> M2["M2 · week 10"]
    M2 --> M3["M3 · week 14"]
```

The diagram uses the small-team expected scenario. M1 and M2 engineering may overlap after feasibility. Re-estimate at M0 based on PGlite session isolation, static origin restrictions, signalling behavior and the native transport outcomes. Re-estimate at M2 before committing a release date. Calendar or hardware delays and architecture changes can exceed the conservative range.

TASK-012 retained the 28 engineer-day M0 baseline: the probes confirmed a viable Hosted Mode path and did not produce evidence requiring a scope expansion. The baseline assumes manual or replaceable signalling, a compatible single-threaded static build and bounded engine behavior. Public service selection, browser matrix expansion and the physical sleep/wake run are release validation, not evidence of general availability. TASK-043 carries the physical host sleep/wake run; re-estimate there if actual recovery requires new implementation work.

## Subsequent releases

The current work packages estimate **28 d** for M4, **20 d** for M5, **20 d** for M6 and **15 d** for M7. In a solo scenario with no overlap, these are approximately 7 / 5 / 5 / 4 additional expected weeks at four engineer-days per week. M6 includes candidate prototypes. M7 includes scope decisions. Both require a follow-up estimate if a prototype or decision expands implementation scope. Replan those releases after their gates and determine parallel capacity once M3 is staffed.
