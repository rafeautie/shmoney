import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import licenses from '@/generated/licenses.json'

// licenses.json is keyed by "name@version"; split on the last @ so scoped
// package names (@tanstack/react-router) stay intact.
const PACKAGES = Object.entries(licenses).map(([id, info]) => {
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), version: id.slice(at + 1), ...info }
})

function PackageRow({ pkg }: { pkg: (typeof PACKAGES)[number] }) {
  const body = (
    <>
      <div className="min-w-0">
        <span className="text-xs font-medium">{pkg.name}</span>
        <span className="ml-2 text-xs text-muted-foreground">{pkg.version}</span>
        {pkg.publisher && <p className="truncate text-xs text-muted-foreground">{pkg.publisher}</p>}
      </div>
      <Badge variant="secondary" className="shrink-0">
        {pkg.licenses ?? 'Unknown'}
      </Badge>
    </>
  )
  const rowClass = 'flex items-center justify-between gap-4 px-4 py-2'

  return pkg.repository ? (
    <a
      href={pkg.repository}
      target="_blank"
      rel="noreferrer"
      className={`${rowClass} transition-colors hover:bg-muted/50`}
    >
      {body}
    </a>
  ) : (
    <div className={rowClass}>{body}</div>
  )
}

export function LicensesDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>View licenses</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Licenses &amp; credits</DialogTitle>
          <DialogDescription>
            shmoney {__APP_VERSION__} ships with {PACKAGES.length} open source packages. Rows link
            to each project.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="rounded-lg border" viewPortClassName="max-h-[60vh]">
          <div className="divide-y">
            {PACKAGES.map((pkg) => (
              <PackageRow key={`${pkg.name}@${pkg.version}`} pkg={pkg} />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
