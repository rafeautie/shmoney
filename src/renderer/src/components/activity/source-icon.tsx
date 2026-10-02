import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDataTransferHorizontalIcon,
  FileImportIcon,
  Refresh01Icon,
  SparklesIcon,
  UserIcon,
  WorkflowSquare03Icon
} from '@hugeicons/core-free-icons'
import type { ActionRunTrigger, ActionSource } from '@shared/ipc'

type Icon = typeof UserIcon

const SOURCE_ICONS: Record<ActionSource, Icon> = {
  user: UserIcon,
  rule: WorkflowSquare03Icon,
  detector: ArrowDataTransferHorizontalIcon,
  llm: SparklesIcon,
  import: FileImportIcon
}

const TRIGGER_ICONS: Record<ActionRunTrigger, Icon> = {
  sync: Refresh01Icon,
  import: FileImportIcon,
  'apply-rules': WorkflowSquare03Icon,
  'ai-categorize': SparklesIcon
}

export function SourceIcon({ source, size }: { source: ActionSource; size?: number }) {
  return <HugeiconsIcon icon={SOURCE_ICONS[source]} size={size} />
}

export function TriggerIcon({ trigger, size }: { trigger: ActionRunTrigger; size?: number }) {
  return <HugeiconsIcon icon={TRIGGER_ICONS[trigger]} size={size} />
}
