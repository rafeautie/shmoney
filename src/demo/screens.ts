// The demo's named screens: what the screenshots are shot from and what an
// embed opens with ?screen=<name>. A host page refers to screens only by name,
// so routes can change here without breaking it. Published as screens.json.

export interface DemoScreen {
  name: string
  /** hash route inside the app */
  route: string
  /** text of a heading to scroll to the top before capturing */
  scrollTo?: string
}

export const SCREENS: DemoScreen[] = [
  { name: 'transactions', route: '/accounts?tab=transactions' },
  { name: 'accounts', route: '/accounts' },
  { name: 'budget', route: '/budget' },
  { name: 'goals', route: '/goals' },
  // the income-versus-spending conversation, the second one seeded
  { name: 'chat', route: '/chat?c=2' },
  { name: 'reports', route: '/reports' },
  { name: 'report-detail', route: '/reports/1' },
  // the Savings Goals template, the household dataset's third report
  { name: 'savings-goals-report', route: '/reports/3' },
  { name: 'activity', route: '/activity' },
  { name: 'settings-llm', route: '/settings', scrollTo: 'Local AI model' }
]
