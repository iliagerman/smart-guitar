import { useState } from 'react'
import { Search } from 'lucide-react'

interface SearchBarProps {
  onSearch: (query: string) => void
  isLoading?: boolean
}

export function SearchBar({ onSearch, isLoading }: SearchBarProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      onSearch(query.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative" data-testid="search-form">
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-smoke-500" />
      <input
        id="search-query"
        name="query"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search songs..."
        className="w-full pl-10 pr-4 py-3 bg-charcoal-700 border border-charcoal-600 rounded-xl text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
        data-testid="search-input"
      />
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 rounded-full border-2 border-charcoal-600 border-t-flame-400 animate-spin" />
        </div>
      )}
    </form>
  )
}
