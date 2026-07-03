import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: HomePage
})

const STACK = [
  { name: 'Electron', description: 'Cross-platform desktop shell' },
  { name: 'React 19', description: 'UI library for the renderer' },
  { name: 'TypeScript', description: 'Type safety across main, preload & renderer' },
  { name: 'TanStack Router', description: 'Type-safe, file-based routing' },
  { name: 'TanStack Query', description: 'Async state & caching for IPC calls' },
  { name: 'TanStack Table', description: 'Headless table used for transaction lists' },
  { name: 'Drizzle ORM', description: 'Typed SQL for SQLite' },
  { name: 'better-sqlite3', description: 'Embedded database engine' },
  { name: 'shadcn/ui', description: 'Accessible Tailwind component primitives' }
]

function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Welcome</h2>
        <p className="text-muted-foreground">
          This is an Electron + React + TypeScript starter wired up with the stack below. Link your
          accounts via SimpleFIN from the Settings page.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {STACK.map((item) => (
          <Card key={item.name}>
            <CardHeader>
              <CardTitle className="text-base">{item.name}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}
