import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

/**
 * Progress against a pace, shared by budget envelopes and savings goals. The
 * tick marks where you should be by now; the stretch between the fill and the
 * tick is hatched when it is on the wrong side, so being off pace reads
 * without color. `offPace` names the wrong side: spending runs `over`, saving
 * falls `under`.
 */
export function PaceBar({
  value,
  pace,
  offPace,
  destructive = false,
  label
}: {
  /** 0 to 100 */
  value: number
  /** 0 to 100, or null for no tick */
  pace: number | null
  offPace: 'over' | 'under'
  destructive?: boolean
  label: string
}) {
  const pct = Math.min(100, Math.max(0, value))
  const tick = pace === null ? null : Math.min(100, Math.max(0, pace))
  const hatch =
    tick === null
      ? null
      : offPace === 'over' && pct > tick
        ? { from: tick, to: pct }
        : offPace === 'under' && pct < tick
          ? { from: pct, to: tick }
          : // on pace: an empty hatch at the tick, kept mounted so it can grow from there
            { from: tick, to: tick }
  const offTrack = hatch !== null && hatch.to > hatch.from

  return (
    <div className="relative">
      <Progress
        value={pct}
        aria-label={offTrack ? `${label}, off pace` : label}
        className={cn(
          '[&_[data-slot=progress-track]]:h-2',
          '[&_[data-slot=progress-indicator]]:transition-[width,background-color] [&_[data-slot=progress-indicator]]:duration-400 [&_[data-slot=progress-indicator]]:ease-smooth motion-reduce:[&_[data-slot=progress-indicator]]:transition-none',
          destructive && '[&_[data-slot=progress-indicator]]:bg-destructive'
        )}
      />
      {hatch !== null && (
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-md">
          <div
            className={cn(
              'absolute inset-y-0 transition-[left,width] duration-400 ease-smooth motion-reduce:transition-none',
              // over: gaps cut into the fill; under: stripes drawn on the empty track
              offPace === 'over'
                ? 'bg-[repeating-linear-gradient(-45deg,transparent_0_2px,var(--background)_2px_4px)] opacity-70'
                : 'bg-[repeating-linear-gradient(-45deg,var(--muted-foreground)_0_2px,transparent_2px_4px)] opacity-50'
            )}
            style={{ left: `${hatch.from}%`, width: `${hatch.to - hatch.from}%` }}
          />
        </div>
      )}
      {tick !== null && (
        <div
          aria-hidden
          className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)] transition-[left] duration-400 ease-smooth motion-reduce:transition-none"
          style={{ left: `${tick}%` }}
        />
      )}
    </div>
  )
}
