import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // .claude holds agent skill scripts (CDP drivers etc.), not app code
  { ignores: ['**/node_modules', '**/out', '**/dist', '**/drizzle', '**/*.gen.ts', '.claude'] },
  tseslint.configs.recommended,
  {
    rules: {
      // an underscore prefix marks a deliberately unused binding (e.g. omitting a
      // field via destructuring rest, or an interface-mandated parameter)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  },
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
        {
          allowExportNames: ['buttonVariants', 'badgeVariants', 'useTheme', 'useSidebar']
        }
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
  {
    // lib modules bundle hooks, stores, and providers together by design; they are
    // not fast-refresh boundaries, so the component-only export rule doesn't apply.
    files: ['src/renderer/src/lib/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  eslintConfigPrettier
)
