import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { SettingsGroup, SettingToggle } from '@/components/settings-controls'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'

/**
 * Header action on the account detail page: a gear button that opens a sidebar of
 * per-account overrides. Currently a single toggle to invert the balance sign, for
 * institutions that report a negative balance when the account holds positive value.
 */
export function AccountSettingsSheet({
  accountId,
  invertBalance
}: {
  accountId: number
  invertBalance: boolean
}) {
  const queryClient = useQueryClient()
  const setInvert = useMutation({
    mutationFn: (next: boolean) =>
      window.api.accounts.setInvertBalance({ accountId, invertBalance: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
  })

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0" aria-label="Account settings">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Account settings</SheetTitle>
          <SheetDescription>Overrides that apply only to this account.</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <SettingsGroup>
            <SettingToggle
              label="Invert balance sign"
              checked={invertBalance}
              onCheckedChange={(on) => setInvert.mutate(on)}
            />
          </SettingsGroup>
          <p className="text-muted-foreground mt-2 text-xs">
            Use this when the institution reports a negative balance for an account that holds
            positive value. Only the displayed balance is flipped; transactions are unchanged.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
