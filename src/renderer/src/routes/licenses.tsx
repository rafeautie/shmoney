import { createFileRoute, Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { Page } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import licenses from '@/generated/licenses.json'

// Not in the sidebar (see nav-main) — reachable only from Settings → About.
export const Route = createFileRoute('/licenses')({
  component: LicensesPage
})

// licenses.json is keyed by "name@version"; split on the last @ so scoped
// package names (@tanstack/react-router) stay intact.
const PACKAGES = Object.entries(licenses).map(([id, info]) => {
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), version: id.slice(at + 1), ...info }
})

function LicensesPage() {
  return (
    <Page className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to="/settings">
            <HugeiconsIcon icon={ArrowLeft01Icon} />
            Settings
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Licenses &amp; credits</h2>
          <p className="text-muted-foreground">
            shmoney {__APP_VERSION__} is built with open source software.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open source licenses</CardTitle>
          <CardDescription>
            {PACKAGES.length} packages ship with this app. Names link to each project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-lg border">
            {PACKAGES.map((pkg) => (
              <div
                key={`${pkg.name}@${pkg.version}`}
                className="flex items-center justify-between gap-4 px-4 py-2"
              >
                <div className="min-w-0">
                  {pkg.repository ? (
                    <a
                      href={pkg.repository}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium hover:underline"
                    >
                      {pkg.name}
                    </a>
                  ) : (
                    <span className="text-xs font-medium">{pkg.name}</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">{pkg.version}</span>
                  {pkg.publisher && (
                    <p className="truncate text-xs text-muted-foreground">{pkg.publisher}</p>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {pkg.licenses ?? 'Unknown'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Page>
  )
}
