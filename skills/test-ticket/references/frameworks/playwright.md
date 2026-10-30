# Framework notes: Playwright

**Follow `automation.howToWriteTests` first** (the host's guide, agents and conventions
override everything below).

- **Spec location**: `automation.specPaths`, default `tests/`.
- **Naming**: one file per ticket area, e.g. `tests/<area>/<key-lower>-<slug>.spec.ts`;
  the **ticket key appears in the `test.describe` title** (and the case id in each test
  title), so `git grep -w <KEY>` over `specPaths` finds it and the ticket counts as
  covered. Commit the file: only tracked files are searched.
- **Run**: through `automation.testMcpServer` when declared (Playwright's
  `run-test-mcp-server`), else `automation.runCommand`, default
  `npx playwright test {file}`.
- **Test data**: `testData.prefix` and the ticket key in every name the test creates.

```ts
import { test, expect } from '@playwright/test';

test.describe('PROJ-313 — order form adapts to permanent contracts', () => {
  test('T2 — permanent type hides the end date', async ({ page }) => {
    await page.goto('/orders/new');
    await page.getByLabel('Contract type').selectOption('Permanent');
    await expect(page.getByLabel('End date')).toBeHidden();
    await expect(page.getByLabel('Probation period')).toBeVisible();
  });
});
```
