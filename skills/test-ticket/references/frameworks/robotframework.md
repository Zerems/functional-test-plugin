# Framework notes: Robot Framework

**Follow `automation.howToWriteTests` first** (the host's guide, agents and conventions
override everything below).

- **Spec location**: `automation.specPaths`, default `tests/` (`*.robot` files).
- **Naming**: e.g. `tests/<area>/<key-lower>_<slug>.robot`; the **ticket key appears in the
  suite `Documentation` and in each test name** (with the case id), and as a `[Tags]`
  value, so `git grep -w <KEY>` over `specPaths` finds it and the ticket counts as
  covered. Commit the file: only tracked files are searched.
- **Run**: through `automation.testMcpServer` when declared, else `automation.runCommand`,
  default `robot {file}`.
- **Test data**: `testData.prefix` and the ticket key in every name the test creates.

```robot
*** Settings ***
Documentation     PROJ-313 — order form adapts to permanent contracts
Library           Browser

*** Test Cases ***
PROJ-313 T2 — permanent type hides the end date
    [Tags]    PROJ-313
    New Page    ${BASE_URL}/orders/new
    Select Options By    id=contract-type    label    Permanent
    Get Element States    id=end-date    contains    detached
    Get Element States    id=probation-period    contains    visible
```

(`${BASE_URL}` comes from the host's variables file or `--variable`.)
