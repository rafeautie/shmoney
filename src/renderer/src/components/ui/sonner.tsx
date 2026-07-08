import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/lib/settings'

function Toaster(props: ToasterProps) {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{ style: { padding: '0.75rem' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
