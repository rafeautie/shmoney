import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BubbleChatIcon,
  Exchange01Icon,
  MailOpen01Icon,
  PiggyBankIcon,
  RepeatIcon,
  Shield01Icon,
  Tag01Icon,
  Tick02Icon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'
import { ipcErrorMessage, cn } from '@/lib/utils'
import { useOnboarding } from '@/lib/settings'
import { useConnectSimpleFin } from '@/hooks/use-connect-simplefin'
import { ExperimentalBadge } from '@/components/experimental-badge'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type IconType = React.ComponentProps<typeof HugeiconsIcon>['icon']

const STEP_COUNT = 5

/** First-run onboarding. Auto-opens whenever onboarding hasn't been finished or
 * skipped — fresh installs default to not-complete. Users can replay it any time
 * from Settings, which flips the flag back off. Finishing resets to the first
 * step so a replay starts from the top. The permanent connect UI also lives on
 * the Settings page. */
export function Onboarding(): React.JSX.Element | null {
  const { onboardingComplete, completeOnboarding } = useOnboarding()
  // Render the flow as a child that fully unmounts once onboarding is done, so
  // reopening it (via "Show again") always starts clean — step 0, empty token,
  // and idle connect/sync mutations rather than stale success/loading state.
  if (onboardingComplete) return null
  return <OnboardingFlow onDone={completeOnboarding} />
}

function OnboardingFlow({ onDone }: { onDone: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const { setupToken, setSetupToken, connect, syncConnection } = useConnectSimpleFin()
  const connectionQuery = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.api.connection.get()
  })

  const isLast = step === STEP_COUNT - 1
  // The last step walks through connecting → syncing → connected. Once the user
  // starts a connect here, the mutations drive the UI; until then, an existing
  // connection means they're already set up (e.g. replaying the tour), so skip
  // straight to the connected state instead of asking for a token again.
  const flowStarted = connect.isPending || connect.isSuccess || connect.isError
  const connecting = connect.isPending
  const syncing = connect.isSuccess && !syncConnection.isSuccess && !syncConnection.isError
  const connected = syncConnection.isSuccess || (!flowStarted && connectionQuery.data != null)
  const busy = connecting || syncing

  const viewAccounts = (): void => {
    navigate({ to: '/accounts' })
    onDone()
  }

  return (
    <Dialog
      open
      // an onboarding modal shouldn't vanish on a stray click or Esc; the
      // Skip button and the close (×) are the deliberate ways out
      onOpenChange={(next, eventDetails) => {
        if (next) return
        if (eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key') {
          eventDetails.cancel()
          return
        }
        onDone()
      }}
    >
      <DialogContent className="flex min-h-120 flex-col gap-0 p-6 min-w-3xl">
        <Logo />
        {/* min-height keeps short steps roomy; taller steps let the card grow */}
        <div className="mt-5 flex-1 space-y-4 overflow-y-auto">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <FeaturesStep />}
          {step === 2 && <BudgetsStep />}
          {step === 3 && <SimpleFinStep />}
          {step === 4 && (
            <PasteTokenStep
              setupToken={setupToken}
              onChange={setSetupToken}
              error={connect.isError ? ipcErrorMessage(connect.error) : null}
              connecting={connecting}
              syncing={syncing}
              connected={connected}
              syncError={syncConnection.isError ? ipcErrorMessage(syncConnection.error) : null}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 pt-5">
          <StepDots step={step} />
          <div className="ml-auto flex gap-2">
            {step === 0 ? (
              <Button variant="ghost" onClick={onDone}>
                Skip
              </Button>
            ) : isLast && connected ? null : (
              <Button variant="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>
                <HugeiconsIcon icon={ArrowLeftIcon} size={16} />
                Back
              </Button>
            )}
            {!isLast ? (
              <Button onClick={() => setStep((s) => s + 1)}>
                Next
                <HugeiconsIcon icon={ArrowRightIcon} size={16} />
              </Button>
            ) : connected ? (
              <Button onClick={viewAccounts}>View accounts</Button>
            ) : (
              <Button disabled={!setupToken.trim() || busy} onClick={() => connect.mutate()}>
                {connecting ? 'Connecting…' : syncing ? 'Syncing…' : 'Connect'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepDots({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-1.5 rounded-full transition-colors',
            i <= step ? 'bg-foreground' : 'bg-muted-foreground/30'
          )}
        />
      ))}
    </div>
  )
}

function WelcomeStep(): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Welcome to shmoney!</DialogTitle>
        <DialogDescription>
          A private money tracker that brings every account into one place: spending, income, and
          balances at a glance.
        </DialogDescription>
      </DialogHeader>
      <p className="text-muted-foreground">
        This quick tour shows what shmoney can do, then helps you connect your first account. It
        takes about a minute.
      </p>
      <Callout icon={Shield01Icon}>
        <span className="font-medium text-foreground">Private by design.</span> Your accounts and
        transactions are stored only on this device, never uploaded to the cloud.
      </Callout>
    </>
  )
}

function FeaturesStep(): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>What you can do</DialogTitle>
        <DialogDescription>
          shmoney turns raw bank data into a clear picture of your money.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <FeatureItem icon={Wallet01Icon} title="Every account together">
          Balances and transactions from all your banks, side by side.
        </FeatureItem>
        <FeatureItem icon={Tag01Icon} title="Categorize spending">
          By hand, or automatically with rules you define.
        </FeatureItem>
        <FeatureItem icon={Analytics01Icon} title="Reports & dashboards">
          Charts and tables that show where your money goes.
        </FeatureItem>
        <FeatureItem icon={Exchange01Icon} title="Transfers handled for you">
          Movements between your own accounts stay out of your income and expense totals.
        </FeatureItem>
        <FeatureItem
          icon={BubbleChatIcon}
          title="Chat with your finances"
          badge={<ExperimentalBadge />}
        >
          Ask a local, on-device model about your money; it queries your data and charts the answer,
          fully offline.
        </FeatureItem>
      </div>
    </>
  )
}

function BudgetsStep(): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Budget with envelopes</DialogTitle>
        <DialogDescription>
          The Budget page uses envelope budgeting: decide up front what each kind of spending gets,
          and always know what's left.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <FeatureItem icon={MailOpen01Icon} title="An envelope per category">
          Pick the categories you care about and fill each with a set amount every month.
        </FeatureItem>
        <FeatureItem icon={RepeatIcon} title="Leftovers roll forward">
          Spend less than the fill and the rest stays in the envelope, building up for bigger or
          irregular expenses.
        </FeatureItem>
        <FeatureItem icon={PiggyBankIcon} title="Overspending stays visible">
          Go over and the envelope carries a negative balance into next month, so slips never hide.
        </FeatureItem>
      </div>
      <p className="text-muted-foreground">
        Find it under <span className="font-medium text-foreground">Budget</span> in the sidebar
        once your accounts are connected.
      </p>
    </>
  )
}

function SimpleFinStep(): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect with SimpleFIN</DialogTitle>
        <DialogDescription>
          shmoney links to your banks through SimpleFIN, a read-only bridge that never sees or
          stores your bank login.
        </DialogDescription>
      </DialogHeader>
      <ol className="space-y-2">
        <NumberedItem n={1}>
          Open the{' '}
          <a
            href="https://bridge.simplefin.org/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-3 hover:text-foreground"
          >
            SimpleFIN Bridge
          </a>{' '}
          and create an account.
        </NumberedItem>
        <NumberedItem n={2}>Connect your banks, then create a setup token.</NumberedItem>
        <NumberedItem n={3}>Copy the token. You&apos;ll paste it on the next step.</NumberedItem>
      </ol>
      <p className="text-muted-foreground">
        The token is exchanged once for an access key stored encrypted on this device.
      </p>
    </>
  )
}

function PasteTokenStep({
  setupToken,
  onChange,
  error,
  connecting,
  syncing,
  connected,
  syncError
}: {
  setupToken: string
  onChange: (value: string) => void
  error: string | null
  connecting: boolean
  syncing: boolean
  connected: boolean
  syncError: string | null
}): React.JSX.Element {
  const busy = connecting || syncing

  const title = connected
    ? "You're all set!"
    : busy
      ? 'Setting up your accounts'
      : 'Paste your setup token'
  const description = connected
    ? 'shmoney is connected and your accounts are synced.'
    : busy
      ? 'Hang tight while shmoney links your accounts and pulls in your data.'
      : 'Almost done: paste the SimpleFIN token to link your accounts and run your first sync.'

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {connected ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <HugeiconsIcon icon={Tick02Icon} size={18} strokeWidth={2.5} />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Accounts synced</p>
            <p className="text-muted-foreground">
              Your accounts and transactions are ready to explore.
            </p>
          </div>
        </div>
      ) : busy ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
          <Spinner />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              {syncing ? 'Syncing your accounts…' : 'Connecting…'}
            </p>
            <p className="text-muted-foreground">
              {syncing
                ? 'Fetching balances and transactions from your banks.'
                : 'Exchanging your setup token for a secure access key.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="onboarding-setup-token">Setup token</Label>
          <Input
            id="onboarding-setup-token"
            value={setupToken}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Base64 setup token"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {syncError && <p className="text-sm text-destructive">Sync failed: {syncError}</p>}
        </div>
      )}
    </>
  )
}

function Spinner(): React.JSX.Element {
  return (
    <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
  )
}

function FeatureItem({
  icon,
  title,
  badge,
  children
}: {
  icon: IconType
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <HugeiconsIcon icon={icon} size={16} />
      </div>
      <div className="space-y-0.5">
        <p className="flex items-center gap-2 font-medium text-foreground">
          {title}
          {badge}
        </p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

function Callout({
  icon,
  children
}: {
  icon: IconType
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-2.5 rounded-lg border bg-muted/40 p-3">
      <HugeiconsIcon icon={icon} size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">{children}</p>
    </div>
  )
}

function NumberedItem({
  n,
  children
}: {
  n: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.65rem] font-medium text-muted-foreground">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}
