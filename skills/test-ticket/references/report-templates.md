# Report templates of the `test-ticket` skill

Two deliverables at the end of a run, in this order: the **chat report** (for the
developer, detailed), then the **tracker comment** (in a separate code block, ready to
paste). The skill writes nothing to the tracker.

Everything below is shown in English. Write the chat report's headings and sentences in
`config.language`; the comment's labels come from the plugin's locale files, so the
script already prints them in that language. Codes (`T1`, `P1`, `OK`, `KO`,
`INCONCLUSIVE`, `UNSTABLE`) and the markers stay as they are.

## 1. Chat report

```markdown
## Test of <KEY> — <short title> · <env> · <YYYY-MM-DD HH:MM>

**Verdict: <OK | KO | INCONCLUSIVE>** — <one sentence: what is demonstrated, or what prevents concluding>.
Delivery: <PR "title" (repository) merged into <branch> on <date> | commit <sha>> · <effective | recent (N min ago) | absent | unknown>
Developer constraints: <or "none">

| Case | P | Result | Proof |
|---|---|---|---|
| T1 <title> | P1 | OK | <HTTP status, text seen on screen, id created> |
| T2 <title> | P2 | KO | <expected / got in one line> |

### KO details
**T2 — <title>**
- Steps: <1., 2., 3.>
- Expected: <…> (criterion <n>)
- Got: <…> (screenshot: `.auth/screenshots/<KEY>-T2.png`)
- Cause hypothesis: <regression | incomplete change | deployment not effective | environment data> — <file:line in the application repository, if identified>

### Data created
<`<prefix> <KEY> …`: type, id, env> — or "none"

### Limits
- Not playable: <id — reason (account or secret missing, external dependency, channel not testable)> — or "none"
- Not played (P3, to arbitrate): <ids> — or "none"
- Unstable: <id — passed on the second try> — or "none"

### Automation candidates (for QA)
- <Tn — title — where it would live (`automation.framework`, area of `automation.specPaths`) — why (lasting behaviour, risk)>
— or "none: <reason>"

### Pitfall discovered
<symptom, cause, precaution> — section omitted when there is none

### Left to the developer
1. Paste the comment below into the ticket.
2. Move the ticket to <statuses.afterOk | statuses.afterKo of the project>. INCONCLUSIVE: do not move it, replay later.
```

Rules: one table row per case; details only for KO cases; one short proof per case (never
a token, a password or a session); KO screenshots stay under `.auth/screenshots/`
(gitignored), never committed to a repository. In file mode the "move the ticket" step
does not apply.

## 2. Tracker comment

Produced by the script, never typed by hand (its data line is what replay and the
`automation-candidates` skill read back):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/comment.mjs format <scratchpad>/report.json
```

Two parts (spec §4.5):

1. A human-readable part in `config.language`, plain text, one line per item:
   - header: marker `[test-ticket]`, title, environment, date, verdict;
   - **cause first**: one `Failure` line per KO case (from its `detail`), or the `Cause`
     line of an INCONCLUSIVE report (from `reason`), right under the header, whatever step
     of the plan the failure happened at;
   - delivery; developer constraints; cases played, one per line with result and detail;
     not played; data created; automation candidates (only if any); pitfall (only if any).
2. A final single line `[test-ticket:data] {…}`: compact JSON with `v`, `env`, `date`,
   `verdict`, `delivery`, `constraints`, `cases[{id,priority,title,result,detail?}]`,
   `notPlayed`, `data`, `candidates`, `pitfall?`, `reason?`. Replay and
   `automation-candidates` parse **this line only**, so the language of the human part
   does not matter. Older comments without a data line are read by a legacy parser.

The markers `[test-ticket]` and `[test-ticket:data]` are constants, never translated: the
first line is what replay looks for in the ticket's comments and what a tracker filter can
subscribe to. Case titles stay on one line.

**The cause is on top.** Someone opening the ticket must see in two lines why it is KO:
each KO case carries `detail` as `expected: … / got: …` (mandatory for a KO). An
INCONCLUSIVE report carries `reason` ("nothing delivered to staging", "API in 503",
"deployment not effective").

### Example

`report.json`:

```json
{
  "v": 1,
  "env": "staging",
  "date": "2026-10-23 14:05",
  "verdict": "KO",
  "delivery": "PR \"feat(order): adapt the order form to permanent contracts\" (shop-front) merged into staging on 2026-10-09",
  "constraints": "",
  "cases": [
    { "id": "T1", "priority": "P1", "title": "Create a permanent order from a request", "result": "OK" },
    { "id": "T2", "priority": "P1", "title": "Fields adapt to the Permanent type (no end date)", "result": "OK" },
    { "id": "T3", "priority": "P2", "title": "Permanent order with a past start date rejected", "result": "KO", "detail": "expected: rejection with a message / got: order created (201)" },
    { "id": "T4", "priority": "P3", "title": "Temporary order unchanged", "result": "OK" }
  ],
  "notPlayed": "",
  "data": "request [E2E] PROJ-313 permanent 7c2a…, order 91be…",
  "candidates": ["T1", "T2"]
}
```

Comment printed with `language: en` (data line shortened here):

```
[test-ticket] Functional tests — staging — 2026-10-23 14:05 — Verdict : KO
Failure : T3 (P2) Permanent order with a past start date rejected — expected: rejection with a message / got: order created (201)
Delivery : PR "feat(order): adapt the order form to permanent contracts" (shop-front) merged into staging on 2026-10-09
Developer constraints : none
Cases played :
- T1 (P1) Create a permanent order from a request : OK
- T2 (P1) Fields adapt to the Permanent type (no end date) : OK
- T3 (P2) Permanent order with a past start date rejected : KO — expected: rejection with a message / got: order created (201)
- T4 (P3) Temporary order unchanged : OK
Not played : none
Data created : request [E2E] PROJ-313 permanent 7c2a…, order 91be…
Automation candidates (QA to arbitrate) : T1, T2
[test-ticket:data] {"v":1,"env":"staging","date":"2026-10-23 14:05","verdict":"KO",…}
```

### Replay

After a fix, the skill reuses the plan of the latest `[test-ticket]` comment of the same
environment and shows the comparison:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.mjs <KEY> --env <env> --replay-text > <scratchpad>/old.txt
node ${CLAUDE_PLUGIN_ROOT}/scripts/comment.mjs diff <scratchpad>/old.txt <scratchpad>/report.json
# T1 : OK → OK
# T2 : OK → OK
# T3 : KO → OK
# T4 : OK → OK
```
