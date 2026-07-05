import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/page'
import { CategoriesSettings } from '@/components/categories-settings'
import { ConnectionSettings } from '@/components/connection-settings'
import { PrivacySettings } from '@/components/privacy-settings'
import { TransferSettings } from '@/components/transfer-settings'

export const Route = createFileRoute('/settings')({
  component: SettingsPage
})

function SettingsPage() {
  return (
    <Page className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage how shmoney connects to your banks.</p>
      </div>

      <ConnectionSettings />

      <TransferSettings />

      <PrivacySettings />

      <CategoriesSettings />
    </Page>
  )
}
