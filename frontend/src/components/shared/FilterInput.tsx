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
      <Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-smoke-400" />
      <input
        id="filter-input"
        name="filter"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-full border border-white/15 bg-white/[0.09] py-3.5 pl-12 pr-10 text-smoke-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_40px_rgba(0,0,0,0.20)] backdrop-blur-xl placeholder:text-smoke-500 transition-[border-color,box-shadow] focus:border-flame-400/50 focus:outline-none focus:ring-2 focus:ring-flame-400/30"
        data-testid="filter-input"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-smoke-500 transition-colors hover:bg-white/10 hover:text-smoke-300"
          aria-label="Clear filter"
          data-testid="filter-input-clear-button"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
