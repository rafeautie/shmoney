import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { Note } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

export const Route = createFileRoute('/notes')({
  component: NotesPage
})

const notesQueryKey = ['notes'] as const

function NotesPage() {
  const queryClient = useQueryClient()
  const notesQuery = useQuery({
    queryKey: notesQueryKey,
    queryFn: () => window.api.notes.list()
  })

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const createNote = useMutation({
    mutationFn: () => window.api.notes.create({ title, body }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      queryClient.invalidateQueries({ queryKey: notesQueryKey })
    }
  })

  const removeNote = useMutation({
    mutationFn: (id: number) => window.api.notes.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesQueryKey })
  })

  const columns = useMemo<ColumnDef<Note>[]>(
    () => [
      { accessorKey: 'title', header: 'Title' },
      { accessorKey: 'body', header: 'Body' },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString()
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            disabled={removeNote.isPending}
            onClick={() => removeNote.mutate(row.original.id)}
          >
            Delete
          </Button>
        )
      }
    ],
    [removeNote]
  )

  const table = useReactTable({
    data: notesQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel()
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Notes</h2>
        <p className="text-muted-foreground">
          Stored in SQLite via Drizzle ORM in the main process, fetched over IPC with TanStack
          Query, and listed with TanStack Table.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New note</CardTitle>
          <CardDescription>Persists to disk immediately on save.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-body">Body</Label>
            <Input
              id="note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Note body"
            />
          </div>
          {createNote.isError && (
            <p className="text-sm text-destructive">{(createNote.error as Error).message}</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            disabled={!title.trim() || createNote.isPending}
            onClick={() => createNote.mutate()}
          >
            {createNote.isPending ? 'Saving...' : 'Save note'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All notes</CardTitle>
        </CardHeader>
        <CardContent>
          {notesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : notesQuery.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
