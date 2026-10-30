# Test design rules applied to a ticket

Operational digest written from the ISTQB Certified Tester Foundation Level syllabus v4.0
(chapters 4 and 5) and the Test Manager syllabus v3.0 (risk-based testing, test closure,
defect reports). It makes the plan of a ticket **identical from one run to the next**: the
rules below apply in order, to every ticket, and every case of the plan cites the rule
that produced it.

## Principle

A test technique does not test more, it tests **enough with few cases**: it says which
values behave alike (one is enough), where defects hide (at the edges), and which
combinations or sequences matter. The black-box techniques below start from the expected
behaviour (the ticket), not from the code: cases stay valid if the implementation changes.

A test case = an id `T<n>`, a title, a priority, a channel (one of the environment's
channels), an account, preconditions and prefixed test data, steps, **one precise
expected result** (text, HTTP status, state), and its source (criterion number + rule).

## Rule 1 — One nominal case per acceptance criterion (P1)

Each acceptance criterion **in scope** (not struck) gives one case that takes it as its
title, played in the user's most common conditions. It is the ticket's "definition of
done": if a P1 fails, the ticket is KO.

- Rephrase the criterion as observable behaviour: "Fields adapt to the permanent
  contract" → "In the order form, contract type Permanent: the end date field disappears,
  the probation period field appears".
- A criterion mixing two behaviours gives two cases.
- A criterion untestable as it stands ("consistent with the mock-up" with no mock-up
  attached) becomes a **not playable** P1 case with the reason, never an OK by default.

## Rule 2 — Equivalence partitions (P2)

*Foundation 4.2.1.* For each input the criterion involves (field, parameter, filter,
status), split the possible values into partitions the system treats alike; one value
per partition is enough, **invalid partitions included**.

- List the valid partitions (what the system must process) and the invalid ones (what it
  must reject or ignore); they do not overlap, none is empty.
- Target coverage: each partition of each input exercised at least once ("each choice");
  combinations belong to rule 5.
- Example: order contract type ∈ {Temporary, Fixed-term, Permanent} (3 valid partitions)
  + missing value + unknown value (`"INTERNSHIP"`) through the API (2 invalid → 422
  expected).
- Example: a "verified suppliers" filter on a product list: product without supplier, with
  a verified supplier, with unverified suppliers only.

## Rule 3 — Boundary values (P2)

*Foundation 4.2.2.* On an **ordered** partition (number, date, length, page), defects sit
at the edges: a misplaced boundary (`<` for `≤`) or a forgotten one. Three-value
technique: the boundary and its two neighbours.

- Numbers and lengths: min−1, min, max, max+1 (file size, results per page, items
  selectable at once).
- Dates: today, yesterday, tomorrow, end of month, 29 February, year change; late evening
  (time zone of the application).
- Pagination: page 1, last page, page beyond, `limit` at 0 and at its maximum.
- Example: "paginate the list and cap the response" → `limit` = cap, cap + 1, 0; empty page
  after the last one.
- Example: an order whose start date is today, yesterday (rejection expected?), last day
  of the month (how the calendar displays it).

## Rule 4 — State transitions (P2)

*Foundation 4.2.4.* When the criterion touches an object with statuses (order, document,
subscription, request), model states and events, then play the **valid** transitions and
attempt at least one **invalid** one (one per case, so that a defect does not hide
another).

- Draw the table: rows = states, columns = events; an empty cell is a forbidden transition
  to check (409/422 rejection expected, button absent or disabled).
- Target coverage: every valid transition the ticket touches, plus the adjacent forbidden
  ones.
- Example: document `DRAFT → SUBMITTED → APPROVED`; approving a document never submitted
  must be rejected; editing an approved document must be refused.
- Example: an archived document cannot go back to `SUBMITTED` without being restored first.

## Rule 5 — Decision tables (P2)

*Foundation 4.2.3.* When the result depends on **at least two conditions** (right + state,
contract type + presence of a date, blocked channel + preference), write the table: one
row per condition, one column per feasible combination, the expected action at the
bottom. Each feasible column is a case.

- Remove impossible combinations, merge those where a condition has no influence (`-`).
  If the table explodes, keep the risky columns (rigour proportional to risk).
- Example: is a notification sent? Conditions = e-mail blocked (yes/no) × SMS blocked
  (yes/no) × recipient preference (e-mail / SMS / both) → which alert goes out.
- Example: permanent order × end date filled → is the end date ignored? rejected? The table
  reveals that the ticket does not say: report it to the developer.

## Rule 6 — Error and robustness cases (P2)

*Foundation 4.4.1 (error guessing), fault attacks.* Typical errors: valid input rejected,
missing parameter, insufficient right, non-existent resource, double submission.

- Required field empty or blank → message and refusal (UI) / 422 (API).
- Another tenant or account that does not own the resource → 403/404, never someone
  else's resource.
- Wrong role (a user without the right on a protected route) → 401/403.
- Non-existent or archived id → a clean 404.
- Double click / identical double `POST` → a single object created.
- **A 5xx, whatever the case, is a defect: KO at once.** An expected 4xx is a test result,
  not an error.

## Rule 7 — Adjacent non-regression (P3)

*Foundation 2.2.4 (regression testing).* The change touched a screen, a route, a
component: the neighbouring behaviour that existed before must hold. One case per direct
neighbour.

- Same form, other contract type; same route, other filter; same shared component (a side
  panel, a date table) on another screen.
- Source: the change's diff (files touched) more than the ticket.
- Played if the plan stays under about fifteen cases; otherwise listed "not played, to
  arbitrate".

## Rule 8 — Known environment pitfalls (precautions, not cases)

*Foundation 4.4.3 (checklists); Test Manager 1.3 (quality risks, past experience).* Before
running, go through the host's pitfalls file (`config.pitfallsFile`): each applicable
pitfall becomes a **precaution** attached to the cases concerned (wait for eventual
consistency before re-reading, pick a record that really exists, check the deployment
before concluding). A precaution is not a test case and does not appear in the verdict,
unless it turns a KO into INCONCLUSIVE.

## Priorities and risk-based testing

*Foundation 5.1.5, 5.2; Test Manager 1.3.* Risk level = likelihood × impact. For a
ticket: impact comes from usage frequency (a daily action for most users) and business
criticality (billing, personal data, real e-mail or SMS sent); likelihood comes from the
size of the change, the number of repositories touched, a shared component, a date rule.

| Priority | Content | Played |
|---|---|---|
| P1 | One case per acceptance criterion (rule 1) | Always; a KO = ticket KO |
| P2 | Partitions, boundaries, transitions, decisions, errors (rules 2 to 6) | Always; a KO = ticket KO |
| P3 | Adjacent non-regression (rule 7) | If ≤ 15 cases in total, else "not played" |

Execution order: "depth first" on the P1 then P2 cases of the highest risk (Test Manager
1.3.4); if time runs short, switch to "breadth first" (at least one case per criterion)
and say so in the verdict's limits.

## Entry and exit criteria

*Foundation 5.1.3; Test Manager 1.1.3.*

**Entry** (otherwise do not start, verdict INCONCLUSIVE): readable ticket with at least one
criterion in scope; change delivered to the environment's branch (or delivery `unknown`,
with a warning); environment and accounts reachable; valid browser session; plan
validated by the developer.

**Exit** (what allows a verdict): every P1 and P2 played or explicitly not playable; no 5xx
met; each KO has a proof (screenshot, status, excerpt) and a cause hypothesis; created data
listed; limits written (not played, unstable, not playable). If an exit criterion is
missing, the verdict is INCONCLUSIVE, never OK.

## Defect report: minimum content of a KO

*Foundation 5.5.1; Test Manager 2.3.5.* So that the developer can reproduce and fix without
coming back to the tester:

1. Title: the anomaly in one line (what happens, not what was expected).
2. Test object and environment: env, PR or commit and its date, account used.
3. Context: case `T<n>` and the rule that produced it, the prefixed test data (ids).
4. Numbered reproduction steps, from a known state.
5. Expected (criterion number) and got (on-screen text, HTTP status and response excerpt,
   screenshot in the scratchpad).
6. Cause hypothesis: regression, incomplete change, deployment not effective, environment
   data, external dependency; `file:line` in the application repository when identified.
7. Severity for the user (blocks / degrades / cosmetic): the developer and QA set the
   priority, the skill only qualifies.

Never in it: a token, a password, a session, real personal data.
