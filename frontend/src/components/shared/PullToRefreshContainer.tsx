import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import { PullIndicator } from './PullIndicator'

const DEFAULT_THRESHOLD = 80

interface PullToRefreshContainerProps {
  children: React.ReactNode
  className?: string
  queryKeys: readonly (readonly unknown[])[]
  disabled?: boolean
}

export function PullToRefreshContainer({
  children,
  className,
  queryKeys: keys,
  disabled,
}: PullToRefreshContainerProps) {
  const queryClient = useQueryClient()

  const handleRefresh = useCallback(async () => {
    await Promise.all(
      keys.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    )
  }, [queryClient, keys])

  const { scrollRef, pullDistance, state } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled,
  })

  return (
    <div
      ref={scrollRef}
      className={cn(className)}
      style={{ overscrollBehaviorY: 'none' }}
    >
      <PullIndicator state={state} pullDistance={pullDistance} threshold={DEFAULT_THRESHOLD} />
      {children}
    </div>
  )
}
