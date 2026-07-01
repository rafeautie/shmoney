import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/out', '**/dist', '**/drizzle', '**/*.gen.ts'] },
  tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      // TanStack Table/Router hooks intentionally return stable function references;
      // this rule assumes React Compiler memoization, which this project doesn't use.
      'react-hooks/incompatible-library': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowExportNames: ['buttonVariants', 'useTheme', 'useSidebar'] }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      // Idiomatic React/shadcn components and hooks skip explicit return types; TS infers them fine.
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // TanStack Router route files pass their component via `component:` rather than
    // exporting it directly, which this rule's static analysis can't follow.
    files: ['src/renderer/src/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  eslintConfigPrettier
)
