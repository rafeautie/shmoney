import { createFileRoute, redirect } from '@tanstack/react-router'

// The app has no home page; Accounts is the landing surface. Onboarding for
// first-run users is a dialog mounted at the root (see onboarding-dialog).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/accounts' })
  }
})
