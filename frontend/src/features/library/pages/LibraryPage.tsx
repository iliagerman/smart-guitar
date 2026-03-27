import { useState, useEffect } from 'react'
import { Library } from 'lucide-react'
import { RecentSongs } from '../components/RecentSongs'
import { SongLibrary } from '../components/SongLibrary'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import { PullToRefreshContainer } from '@/components/shared/PullToRefreshContainer'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { FilterInput } from '@/components/shared/FilterInput'
import { queryKeys } from '@/api/query-keys'

export function LibraryPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="relative h-full flex flex-col overflow-hidden" data-testid="library-page">
      <PageBackground />
      <div className="shrink-0">
        <PageHeader title="Library" icon={<Library size={24} />} subtitle="Shared song collection">
          <FilterInput value={search} onChange={setSearch} placeholder="Filter songs..." />
        </PageHeader>
      </div>
      <PullToRefreshContainer className="flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom)+var(--vv-bottom-offset))] lg:pb-0" queryKeys={[queryKeys.songs.all]}>
        <PageContainer>
          {!debouncedSearch && (
            <section className="mb-8">
              <SectionHeading title="Recently Added" />
              <RecentSongs />
            </section>
          )}
          <section>
            <SectionHeading title={debouncedSearch ? 'Results' : 'All Songs'} />
            <SongLibrary query={debouncedSearch || undefined} />
          </section>
        </PageContainer>
      </PullToRefreshContainer>
    </div>
  )
}
