import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import { FavoritesList } from '../components/FavoritesList'
import { FavoritesSortControl } from '../components/FavoritesSortControl'
import { useFavorites } from '../hooks/use-favorites'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import { PullToRefreshContainer } from '@/components/shared/PullToRefreshContainer'
import { FilterInput } from '@/components/shared/FilterInput'
import { queryKeys } from '@/api/query-keys'

export function FavoritesPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const { data: favorites } = useFavorites()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="favorites-page">
      <PageBackground />
      <div className="shrink-0">
        <PageHeader title="Favorites" icon={<Heart size={24} />} subtitle="Songs you love">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterInput value={search} onChange={setSearch} placeholder="Filter favorites..." />
            {!!favorites?.length && <FavoritesSortControl />}
          </div>
        </PageHeader>
      </div>
      <PullToRefreshContainer className="flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0" queryKeys={[queryKeys.favorites.all]}>
        <PageContainer>
          <FavoritesList query={debouncedSearch || undefined} />
        </PageContainer>
      </PullToRefreshContainer>
    </div>
  )
}
