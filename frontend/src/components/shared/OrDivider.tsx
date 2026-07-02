export function OrDivider() {
  return (
    <div className="relative flex items-center gap-4 my-2">
      <div className="flex-1 h-px bg-charcoal-600" />
      <span className="text-xs font-medium text-smoke-500" data-testid="auth-divider-or">or</span>
      <div className="flex-1 h-px bg-charcoal-600" />
    </div>
  )
}
