import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import { FavoritesList } from '../components/FavoritesList'
import { PageBackground } from '@/components/shared/PageBackground'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageContainer } from '@/components/shared/PageContainer'
import { FilterInput } from '@/components/shared/FilterInput'

export function FavoritesPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="relative min-h-full flex flex-col" data-testid="favorites-page">
      <PageBackground />
      <PageHeader title="Favorites" icon={<Heart size={24} />} subtitle="Songs you love">
        <FilterInput value={search} onChange={setSearch} placeholder="Filter favorites..." />
      </PageHeader>
      <PageContainer>
        <FavoritesList query={debouncedSearch || undefined} />
      </PageContainer>
    </div>
  )
}
