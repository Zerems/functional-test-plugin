# Framework notes: Cypress

**Follow `automation.howToWriteTests` first** (the host's guide, agents and conventions
override everything below).

- **Spec location**: `automation.specPaths`, default `cypress/e2e/`.
- **Naming**: e.g. `cypress/e2e/<area>/<key-lower>-<slug>.cy.ts`; the **ticket key appears
  in the `describe` title** (and the case id in each `it` title), so `git grep -w <KEY>`
  over `specPaths` finds it and the ticket counts as covered. Commit the file: only tracked
  files are searched.
- **Run**: through `automation.testMcpServer` when declared, else `automation.runCommand`,
  default `npx cypress run --spec {file}`.
- **Test data**: `testData.prefix` and the ticket key in every name the test creates.

```ts
describe('PROJ-313 — order form adapts to permanent contracts', () => {
  it('T2 — permanent type hides the end date', () => {
    cy.visit('/orders/new');
    cy.findByLabelText('Contract type').select('Permanent');
    cy.findByLabelText('End date').should('not.exist');
    cy.findByLabelText('Probation period').should('be.visible');
  });
});
```

(`findByLabelText` comes from `@testing-library/cypress`; use the host's own selectors
helpers if it has others.)
