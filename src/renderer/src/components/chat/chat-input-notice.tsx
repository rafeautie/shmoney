/** Shown in the composer's place when the conversation is read-only. */
export function ChatInputNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4 pt-2">
      <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        {children}
      </p>
    </div>
  )
}
