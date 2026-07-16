// deep-link into the repo's issue forms (.github/ISSUE_TEMPLATE): GitHub
// prefills any form field whose id matches a query param
function issueUrl(params: Record<string, string>): string {
  return `https://github.com/rafeautie/shmoney/issues/new?${new URLSearchParams(params)}`
}

export function bugReportUrl(): string {
  // version and OS are no longer prefilled: they're carried by the diagnostics
  // block the Report bug dialog copies to the clipboard
  return issueUrl({ template: 'bug_report.yml' })
}

export function featureRequestUrl(): string {
  return issueUrl({ template: 'feature_request.yml' })
}
