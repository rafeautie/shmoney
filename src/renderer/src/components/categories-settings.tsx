import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, PencilEdit02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { Category, CategoryGroup } from '@shared/ipc'
import { ipcErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { SettingsGroup, SettingAction } from './settings-controls'
import { ConfirmDialog } from './confirm-dialog'

export function CategoriesSettings() {
  const queryClient = useQueryClient()

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })

  const [newGroupName, setNewGroupName] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)

  const createGroup = useMutation({
    mutationFn: () => window.api.categories.createGroup({ name: newGroupName }),
    onSuccess: () => setNewGroupName(''),
    onSettled: () => queryClient.invalidateQueries()
  })

  const resetDefaults = useMutation({
    mutationFn: () => window.api.categories.resetDefaults(),
    onSuccess: () => setConfirmingReset(false),
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categories</CardTitle>
        <CardDescription>
          Group your categories and assign them to transactions. Hover a category to rename or
          delete it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categoriesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {categoriesQuery.data?.groups.map((group) => (
              <div key={group.id} className="space-y-4">
                <Separator className="-mx-(--card-spacing) data-horizontal:w-auto" />
                <GroupSection group={group} />
              </div>
            ))}
            <div className="space-y-4">
              <Separator className="-mx-(--card-spacing) data-horizontal:w-auto" />
              <div className="flex flex-col gap-2">
                <div className="flex min-h-7 items-center gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Ungrouped</h3>
                </div>
                <CategoryList groupId={null} categories={categoriesQuery.data?.ungrouped ?? []} />
              </div>
            </div>
          </>
        )}
        <Separator className="-mx-(--card-spacing) data-horizontal:w-auto" />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            createGroup.mutate()
          }}
        >
          <Input
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder="New group name"
            className="max-w-60"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!newGroupName.trim() || createGroup.isPending}
          >
            Add group
          </Button>
        </form>
        {createGroup.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(createGroup.error)}</p>
        )}
        <SettingsGroup>
          <SettingAction
            label="Reset to defaults"
            description="Restore the default groups and categories; all transactions become Uncategorized."
          >
            <Button variant="destructive" onClick={() => setConfirmingReset(true)}>
              Reset
            </Button>
          </SettingAction>
        </SettingsGroup>
        {resetDefaults.isError && (
          <p className="text-sm text-destructive">
            Reset failed: {ipcErrorMessage(resetDefaults.error)}
          </p>
        )}
        <ConfirmDialog
          open={confirmingReset}
          onOpenChange={setConfirmingReset}
          title="Reset to defaults?"
          description="This restores the default groups and categories and sets ALL transactions to Uncategorized."
          confirmLabel="Reset"
          pendingLabel="Resetting…"
          pending={resetDefaults.isPending}
          onConfirm={() => resetDefaults.mutate()}
        />
      </CardContent>
    </Card>
  )
}

function GroupSection({ group }: { group: CategoryGroup }) {
  const queryClient = useQueryClient()

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [renameDraft, setRenameDraft] = useState<string | null>(null)

  const renameGroup = useMutation({
    mutationFn: (name: string) => window.api.categories.renameGroup({ id: group.id, name }),
    onSuccess: () => setRenameDraft(null),
    onSettled: () => queryClient.invalidateQueries()
  })

  const deleteGroup = useMutation({
    mutationFn: () => window.api.categories.deleteGroup(group.id),
    onSuccess: () => setConfirmingDelete(false),
    onSettled: () => queryClient.invalidateQueries()
  })

  const error = deleteGroup.error ?? renameGroup.error

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        {renameDraft !== null ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              renameGroup.mutate(renameDraft)
            }}
          >
            <Input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setRenameDraft(null)}
              className="w-60"
            />
            <Button type="submit" disabled={!renameDraft.trim() || renameGroup.isPending}>
              {renameGroup.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRenameDraft(null)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <h3 className="text-sm font-medium">{group.name}</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename group ${group.name}`}
              onClick={() => setRenameDraft(group.name)}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={`Delete group ${group.name}`}
              onClick={() => setConfirmingDelete(true)}
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
            </Button>
          </>
        )}
      </div>
      <CategoryList groupId={group.id} categories={group.categories} />
      {error != null && <p className="text-sm text-destructive">{ipcErrorMessage(error)}</p>}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${group.name}”?`}
        description="Deletes the group and its categories. Their transactions become uncategorized."
        pending={deleteGroup.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => deleteGroup.mutate()}
      />
    </div>
  )
}

function CategoryList({ groupId, categories }: { groupId: number | null; categories: Category[] }) {
  const queryClient = useQueryClient()

  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const createCategory = useMutation({
    mutationFn: () => window.api.categories.create({ groupId, name: newCategoryName }),
    onSuccess: () => setNewCategoryName(''),
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((category) => (
          <CategoryChip key={category.id} category={category} />
        ))}
        {addingCategory ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              createCategory.mutate()
            }}
          >
            <Input
              autoFocus
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setAddingCategory(false)}
              placeholder="Category name"
              className="w-44"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!newCategoryName.trim() || createCategory.isPending}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAddingCategory(false)
                setNewCategoryName('')
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setAddingCategory(true)}>
            <HugeiconsIcon icon={PlusSignIcon} size={14} />
            Add category
          </Button>
        )}
      </div>
      {createCategory.isError && (
        <p className="text-sm text-destructive">{ipcErrorMessage(createCategory.error)}</p>
      )}
    </>
  )
}

function CategoryChip({ category }: { category: Category }) {
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [renameDraft, setRenameDraft] = useState(category.name)

  const rename = useMutation({
    mutationFn: () => window.api.categories.rename({ id: category.id, name: renameDraft }),
    onSuccess: () => setMode('view'),
    onSettled: () => queryClient.invalidateQueries()
  })

  const deleteCategory = useMutation({
    mutationFn: () => window.api.categories.delete(category.id),
    onSuccess: () => setConfirmingDelete(false),
    onSettled: () => queryClient.invalidateQueries()
  })

  const error = rename.error ?? deleteCategory.error

  if (mode === 'edit') {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          rename.mutate()
        }}
      >
        <Input
          autoFocus
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setMode('view')}
          className="w-44"
        />
        <Button
          type="submit"
          disabled={!renameDraft.trim() || renameDraft.trim() === category.name || rename.isPending}
        >
          {rename.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setMode('view')}>
          Cancel
        </Button>
        {rename.isError && (
          <span className="text-xs text-destructive">{ipcErrorMessage(rename.error)}</span>
        )}
      </form>
    )
  }

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
            aria-label={`Rename category ${category.name}`}
            onClick={() => {
              setRenameDraft(category.name)
              rename.reset()
              setMode('edit')
            }}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={10} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete category ${category.name}`}
            onClick={() => {
              deleteCategory.reset()
              setConfirmingDelete(true)
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} size={10} />
          </Button>
        </span>
      </span>
      {error != null && <span className="pl-1 text-destructive">{ipcErrorMessage(error)}</span>}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${category.name}”?`}
        description="Its transactions become uncategorized."
        pending={deleteCategory.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => deleteCategory.mutate()}
      />
    </span>
  )
}
