import { cn } from '@/lib/cn'

interface TunerGaugeProps {
  cents: number
  active: boolean
}

export function TunerGauge({ cents, active }: TunerGaugeProps) {
  // Map cents (-50 to +50) to angle (-90 to +90 degrees)
  const angle = active ? (cents / 50) * 90 : 0

  const inTuneColor = Math.abs(cents) <= 5
  const closeColor = Math.abs(cents) <= 15

  return (
    <div
      className="w-full max-w-xs mx-auto"
      role="meter"
      aria-label="Tuning accuracy"
      aria-valuenow={active ? Math.round(cents) : 0}
      aria-valuemin={-50}
      aria-valuemax={50}
      data-testid="tuner-gauge"
    >
      <svg viewBox="0 0 300 170" className="w-full" aria-hidden="true">
        {/* Background arc segments */}
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="25%" stopColor="#f59e0b" />
            <stop offset="45%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#22c55e" />
            <stop offset="55%" stopColor="#22c55e" />
            <stop offset="75%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>

        {/* Gauge arc */}
        <path
          d="M 30 150 A 120 120 0 0 1 270 150"
          fill="none"
          stroke="url(#gauge-gradient)"
          strokeWidth="8"
          strokeLinecap="round"
          opacity={active ? 0.8 : 0.2}
        />

        {/* Tick marks */}
        {[-50, -25, 0, 25, 50].map((tick) => {
          const tickAngle = ((tick / 50) * 90 - 90) * (Math.PI / 180)
          const cx = 150
          const cy = 150
          const r1 = 108
          const r2 = 98
          const x1 = cx + r1 * Math.cos(tickAngle)
          const y1 = cy + r1 * Math.sin(tickAngle)
          const x2 = cx + r2 * Math.cos(tickAngle)
          const y2 = cy + r2 * Math.sin(tickAngle)
          return (
            <line
              key={tick}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={tick === 0 ? '#22c55e' : '#64748b'}
              strokeWidth={tick === 0 ? 3 : 1.5}
            />
          )
        })}

        {/* Needle */}
        <g
          className="transition-transform duration-150 ease-out"
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: '150px 150px',
          }}
        >
          <line
            x1="150"
            y1="150"
            x2="150"
            y2="35"
            stroke={
              !active
                ? '#475569'
                : inTuneColor
                  ? '#22c55e'
                  : closeColor
                    ? '#f59e0b'
                    : '#ef4444'
            }
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="150" cy="150" r="6" fill="#e2e8f0" />
        </g>

        {/* Labels */}
        <text x="35" y="165" fill="#94a3b8" fontSize="12" textAnchor="middle">
          flat
        </text>
        <text x="265" y="165" fill="#94a3b8" fontSize="12" textAnchor="middle">
          sharp
        </text>
      </svg>

      {/* In-tune indicator */}
      {active && inTuneColor && (
        <div className="text-center -mt-2">
          <span
            className={cn(
              'inline-block px-3 py-0.5 rounded-full text-xs font-semibold',
              'bg-green-500/20 text-green-400'
            )}
          >
            In Tune
          </span>
        </div>
      )}
    </div>
  )
}
