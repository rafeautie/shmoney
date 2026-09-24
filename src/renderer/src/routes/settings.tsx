import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/page'
import { CategoriesSettings } from '@/components/settings/categories-settings'
import { ConnectionSettings } from '@/components/settings/connection-settings'
import { NotificationSettings } from '@/components/settings/notification-settings'
import { AppearanceSettings } from '@/components/settings/appearance-settings'
import { PrivacySettings } from '@/components/settings/privacy-settings'
import { TransferSettings } from '@/components/settings/transfer-settings'
import { RulesSettings } from '@/components/settings/rules-settings'
import { LlmSettings } from '@/components/settings/llm-settings'
import { StorageSettings } from '@/components/settings/storage-settings'
import { AboutSettings } from '@/components/settings/about-settings'
import { isDemo } from '@/lib/platform'

export const Route = createFileRoute('/settings')({
  component: SettingsPage
})

function SettingsPage() {
  return (
    <Page className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your connection, categories, rules, and privacy.
        </p>
      </div>

      <ConnectionSettings />

      <TransferSettings />

      <AppearanceSettings />

      <PrivacySettings />

      {/* OS notifications have no counterpart in a browser tab */}
      {!isDemo && <NotificationSettings />}

      <LlmSettings />

      <CategoriesSettings />

      <RulesSettings />

      <StorageSettings />

      <AboutSettings />
    </Page>
  )
}
