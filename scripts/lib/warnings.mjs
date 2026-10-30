/** Warnings shown at the top of the test plan, from the ticket status, the environment and the delivery. */

/**
 * `{ stop, lines }`: `stop` when the ticket's status says not to test it (a single line then);
 * otherwise one line per concern. `prs` is the tracker's pull requests, or null when unknown.
 */
export function planWarnings({ issue, envName, defaultEnv, config, delivery, prs, t }) {
  const { toTest = [], doNotTest = [] } = config.tracker.statuses ?? {};
  if (doNotTest.includes(issue.status)) return { stop: true, lines: [t('warnings.doNotTest', { status: issue.status })] };

  const lines = [];
  if (toTest.length > 0 && !toTest.includes(issue.status)) {
    lines.push(t('warnings.statusUnexpected', { status: issue.status, expected: toTest.join(' / ') }));
  }
  if (envName !== defaultEnv) lines.push(t('warnings.envForced', { env: envName, default: defaultEnv }));

  const branch = config.environments[envName].branch;
  const knownBranches = new Set(Object.values(config.environments).map((env) => env.branch));
  const merged = (prs ?? []).filter((p) => p.status === 'MERGED');
  const otherTargets = [...new Set(merged.map((p) => p.targetBranch))].filter((target) => target !== branch && knownBranches.has(target));
  if (merged.length > 0 && !merged.some((p) => p.targetBranch === branch) && otherTargets.length > 0) {
    lines.push(t('warnings.otherTargets', { targets: otherTargets.join(', '), branch }));
  }
  for (const repository of delivery.partialRepos ?? []) lines.push(t('warnings.partial', { repository, branch }));
  if (delivery.state === 'unknown') lines.push(t('warnings.deliveryUnknown', { reason: t(`delivery.reason.${delivery.reason}`, { branch }) }));
  for (const { repository, lastLocalAt, mergedAt } of delivery.staleRefs ?? []) {
    lines.push(t('warnings.staleRef', { repository, localDate: lastLocalAt, mergedAt }));
  }
  for (const { repository, reason } of delivery.unreadRepositories ?? []) {
    lines.push(t('warnings.unreadRepository', { repository, branch, reason: t(`delivery.unread.${reason}`) }));
  }
  return { stop: false, lines };
}
