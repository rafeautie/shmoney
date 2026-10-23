import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, PencilEdit02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Category, CategoryGroup } from '@shared/ipc'
import { ipcErrorMessage } from '@/lib/utils'
import { invalidateCategoryData } from '@/lib/invalidate'
import { toastUndoable } from '@/lib/undo-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SettingsGroup, SettingAction, SettingsSection, SettingsSubpage } from './settings-controls'
import { ConfirmButton } from '@/components/confirm-dialog'

// what the edit sub-page is showing: a category (new ones land in `groupId`)
// or a group, each new when the item is missing. Settings is itself a modal,
// so edits open as a page within it rather than a second modal on top
type Editing =
  | { kind: 'category'; category?: Category; groupId: number | null }
  | { kind: 'group'; group?: CategoryGroup }

type OnEdit = (editing: Editing) => void

export function CategoriesSettings() {
  const queryClient = useQueryClient()

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const groups = categoriesQuery.data?.groups ?? []

  const [editing, setEditing] = useState<Editing | null>(null)
  // the sub-page replaces the list in the same scroll area, which may be
  // scrolled down to the chip that was picked; start the page at its top
  const revealPage = useCallback((el: HTMLElement | null) => {
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [])

  const resetDefaults = useMutation({
    meta: { silenceError: true },
    mutationFn: () => window.api.categories.resetDefaults(),
    onSettled: () => invalidateCategoryData(queryClient)
  })

  if (editing) {
    const back = (): void => setEditing(null)
    return (
      <div ref={revealPage} className="scroll-mt-6">
        {editing.kind === 'category' ? (
          <CategoryPage
            key={editing.category?.id ?? 'new'}
            category={editing.category}
            groupId={editing.groupId}
            groups={groups}
            onDone={back}
          />
        ) : (
          <GroupPage key={editing.group?.id ?? 'new'} group={editing.group} onDone={back} />
        )}
      </div>
    )
  }

  return (
    <SettingsSection
      title="Categories"
      description="Group your categories and assign them to transactions. Hover a category to edit or delete it."
    >
      {categoriesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <SettingsGroup>
            {groups.map((group) => (
              <GroupSection key={group.id} group={group} onEdit={setEditing} />
            ))}
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="flex min-h-7 items-center gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">Ungrouped</h3>
              </div>
              <CategoryList
                groupId={null}
                categories={categoriesQuery.data?.ungrouped ?? []}
                onEdit={setEditing}
              />
            </div>
            <div className="px-4 py-3">
              <Button variant="outline" onClick={() => setEditing({ kind: 'group' })}>
                <HugeiconsIcon icon={PlusSignIcon} size={14} />
                Add Group
              </Button>
            </div>
          </SettingsGroup>
          <SettingsGroup>
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="flex min-h-7 items-center gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">System</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(categoriesQuery.data?.system ?? []).map((category) => (
                  <span
                    key={category.id}
                    className="inline-flex h-7 items-center rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                  >
                    {category.name}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Used by shmoney for built-in behavior like transfer detection; they can&apos;t be
                renamed or deleted.
              </p>
            </div>
          </SettingsGroup>
        </>
      )}
      <SettingsGroup>
        <SettingAction
          label="Reset to Defaults"
          description="Restore the default groups and categories; transactions in them become Uncategorized. System categories and their transactions are kept."
        >
          <ConfirmButton
            variant="destructive"
            title="Reset to Defaults?"
            description="This restores the default groups and categories and sets their transactions to Uncategorized. System categories (and the transactions assigned to them) are kept."
            confirmLabel="Reset"
            pendingLabel="Resetting…"
            pending={resetDefaults.isPending}
            onConfirm={(close) => resetDefaults.mutate(undefined, { onSuccess: close })}
          >
            Reset
          </ConfirmButton>
        </SettingAction>
      </SettingsGroup>
      {resetDefaults.isError && (
        <p className="text-sm text-destructive">
          Reset failed: {ipcErrorMessage(resetDefaults.error)}
        </p>
      )}
    </SettingsSection>
  )
}

function GroupSection({ group, onEdit }: { group: CategoryGroup; onEdit: OnEdit }) {
  const queryClient = useQueryClient()

  const deleteGroup = useMutation({
    meta: { silenceError: true },
    mutationFn: () => window.api.categories.deleteGroup(group.id),
    onSuccess: (actionId) => {
      if (actionId !== null) toastUndoable(`Deleted “${group.name}”`, actionId, queryClient)
    },
    onSettled: () => invalidateCategoryData(queryClient)
  })

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-sm font-medium select-text">{group.name}</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename group ${group.name}`}
          onClick={() => onEdit({ kind: 'group', group })}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5" />
        </Button>
        {/* no confirm: the toast's Undo brings the group back */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={`Delete group ${group.name}`}
          disabled={deleteGroup.isPending}
          onClick={() => deleteGroup.mutate()}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
        </Button>
      </div>
      <CategoryList groupId={group.id} categories={group.categories} onEdit={onEdit} />
      {deleteGroup.isError && (
        <p className="text-sm text-destructive">{ipcErrorMessage(deleteGroup.error)}</p>
      )}
    </div>
  )
}

function CategoryList({
  groupId,
  categories,
  onEdit
}: {
  groupId: number | null
  categories: Category[]
  onEdit: OnEdit
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {categories.map((category) => (
        <CategoryChip key={category.id} category={category} onEdit={onEdit} />
      ))}
      <Button variant="outline" onClick={() => onEdit({ kind: 'category', groupId })}>
        <HugeiconsIcon icon={PlusSignIcon} size={14} />
        Add Category
      </Button>
    </div>
  )
}

function CategoryChip({ category, onEdit }: { category: Category; onEdit: OnEdit }) {
  const queryClient = useQueryClient()

  const deleteCategory = useMutation({
    meta: { silenceError: true },
    mutationFn: () => window.api.categories.delete(category.id),
    onSuccess: (actionId) => {
      if (actionId !== null) toastUndoable(`Deleted “${category.name}”`, actionId, queryClient)
    },
    onSettled: () => invalidateCategoryData(queryClient)
  })

  return (
    <span className="group/chip inline-flex h-7 items-center rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-[padding] duration-200 focus-within:pr-1 hover:pr-1">
      {category.name}
      {/* 0fr -> 1fr animates the reveal to content width; plain width can't transition to auto */}
      <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-200 group-focus-within/chip:grid-cols-[1fr] group-focus-within/chip:opacity-100 group-hover/chip:grid-cols-[1fr] group-hover/chip:opacity-100">
        <span className="flex min-w-0 items-center overflow-hidden">
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-1.5"
            aria-label={`Edit category ${category.name}`}
            onClick={() => onEdit({ kind: 'category', category, groupId: category.groupId })}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5" />
          </Button>
          {/* no confirm: the toast's Undo brings it back, assignments included */}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete category ${category.name}`}
            disabled={deleteCategory.isPending}
            onClick={() => deleteCategory.mutate()}
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
          </Button>
        </span>
      </span>
      {deleteCategory.isError && (
        <span className="pl-1 text-destructive">{ipcErrorMessage(deleteCategory.error)}</span>
      )}
    </span>
  )
}

/**
 * An edit sub-page's form: the fields, any error, then Cancel and the save
 * button. Escape from the form cancels back to the list instead of closing
 * Settings.
 */
function EditForm({
  title,
  description,
  submitLabel,
  canSubmit,
  pending,
  error,
  onSubmit,
  onDone,
  children
}: {
  title: string
  description: string
  submitLabel: string
  canSubmit: boolean
  pending: boolean
  error: unknown
  onSubmit: () => void
  onDone: () => void
  children: React.ReactNode
}) {
  return (
    <SettingsSubpage parent="Categories" title={title} description={description} onBack={onDone}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit && !pending) onSubmit()
        }}
        onKeyDown={(event) => {
          // only Escapes nothing inside already used (an open select handles its own);
          // preventing the default keeps Settings open
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          onDone()
        }}
      >
        <div className="space-y-4 rounded-lg border p-4">
          {children}
          {error != null && <p className="text-sm text-destructive">{ipcErrorMessage(error)}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </SettingsSubpage>
  )
}

const UNGROUPED = 'ungrouped'

/** Adds a category to `groupId`, or edits both fields of `category`: its name and group. */
function CategoryPage({
  category,
  groupId: initialGroupId,
  groups,
  onDone
}: {
  category?: Category
  /** where a new category lands; an edit starts from the category's own group */
  groupId: number | null
  groups: CategoryGroup[]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(category?.name ?? '')
  const [groupId, setGroupId] = useState<number | null>(initialGroupId)

  const save = useMutation({
    meta: { silenceError: true },
    mutationFn: async (input: { name: string; groupId: number | null }): Promise<void> => {
      if (category) await window.api.categories.rename({ id: category.id, ...input })
      else await window.api.categories.create(input)
    },
    onSuccess: onDone,
    onSettled: () => invalidateCategoryData(queryClient)
  })

  const trimmed = name.trim()
  const groupItems: Record<string, string> = {
    ...Object.fromEntries(groups.map((g) => [String(g.id), g.name])),
    [UNGROUPED]: 'Ungrouped'
  }

  return (
    <EditForm
      title={category ? 'Edit Category' : 'Add Category'}
      description={
        category
          ? 'Its transactions, rules and envelope stay with it.'
          : 'Use it on transactions, rules and envelopes once it exists.'
      }
      submitLabel={category ? 'Save' : 'Add Category'}
      canSubmit={trimmed !== ''}
      pending={save.isPending}
      error={save.error}
      onSubmit={() => {
        if (category && trimmed === category.name && groupId === category.groupId) return onDone()
        save.mutate({ name: trimmed, groupId })
      }}
      onDone={onDone}
    >
      <div className="space-y-2">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Groceries"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Group</Label>
        <Select
          value={groupId === null ? UNGROUPED : String(groupId)}
          items={groupItems}
          onValueChange={(v) => setGroupId(v === UNGROUPED ? null : Number(v))}
        >
          <SelectTrigger aria-label="Group" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>
                {g.name}
              </SelectItem>
            ))}
            <SelectItem value={UNGROUPED}>Ungrouped</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </EditForm>
  )
}

/** Adds a group, or renames `group`: a name is all a group has. */
function GroupPage({ group, onDone }: { group?: CategoryGroup; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(group?.name ?? '')

  const save = useMutation({
    meta: { silenceError: true },
    mutationFn: async (next: string): Promise<void> => {
      if (group) await window.api.categories.renameGroup({ id: group.id, name: next })
      else await window.api.categories.createGroup({ name: next })
    },
    onSuccess: onDone,
    onSettled: () => invalidateCategoryData(queryClient)
  })

  const trimmed = name.trim()
  return (
    <EditForm
      title={group ? 'Rename Group' : 'Add Group'}
      description="Groups gather related categories in budgets, reports and pickers."
      submitLabel={group ? 'Save' : 'Add Group'}
      canSubmit={trimmed !== ''}
      pending={save.isPending}
      error={save.error}
      onSubmit={() => (group && trimmed === group.name ? onDone() : save.mutate(trimmed))}
      onDone={onDone}
    >
      <div className="space-y-2">
        <Label htmlFor="group-name">Name</Label>
        <Input
          id="group-name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Needs"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </EditForm>
  )
}
