import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/cn'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
}

/**
 * Radix-based replacement for the native `confirm()` popup, styled to match
 * the app's other dialogs (see PaywallDialog).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-2xl bg-charcoal-900 border border-charcoal-700 shadow-2xl p-6"
          data-testid="confirm-dialog"
        >
          <Dialog.Title className="text-lg font-bold text-smoke-100">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-2 text-sm text-smoke-400">{description}</Dialog.Description>
          )}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-charcoal-600 bg-charcoal-700 px-4 py-2 text-sm font-semibold text-smoke-100 transition-colors hover:border-flame-400/30"
                data-testid="confirm-dialog-cancel-button"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onConfirm()
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                variant === 'destructive'
                  ? 'bg-red-500 text-smoke-100 hover:bg-red-600'
                  : 'bg-flame-400 text-charcoal-950 hover:bg-flame-500',
              )}
              data-testid="confirm-dialog-confirm-button"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
