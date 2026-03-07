import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface FilterInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function FilterInput({ value, onChange, placeholder = 'Filter...', className }: FilterInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-smoke-500" />
      <input
        id="filter-input"
        name="filter"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-10 py-3 bg-charcoal-700 border border-charcoal-600 rounded-xl text-smoke-100 placeholder:text-smoke-600 focus:outline-none focus:ring-2 focus:ring-flame-400 transition-all"
        data-testid="filter-input"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-smoke-500 hover:text-smoke-300 transition-colors"
          aria-label="Clear filter"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
