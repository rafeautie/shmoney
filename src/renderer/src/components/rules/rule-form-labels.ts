import type { Rule } from '@shared/rules'

// the rule form's heading, shared by its dialog and the Settings sub-page that
// hosts it inline
export const ruleFormTitle = (rule: Rule | null): string => (rule ? 'Edit Rule' : 'Add Rule')
export const RULE_FORM_DESCRIPTION =
  'A rule applies its action to transactions matching every condition you set.'
