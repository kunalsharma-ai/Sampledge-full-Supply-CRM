'use client';
/**
 * Audience Orbit X overlay primitives, shadcn/ui-style wrappers over Radix: Dialog, Sheet, Popover,
 * Tooltip, Tabs, Switch, DropdownMenu and a ConfirmDialog for destructive operations.
 * Radix handles focus trapping, Escape, aria wiring and returning focus; we add the visual layer.
 */
import * as D from '@radix-ui/react-dialog';
import * as P from '@radix-ui/react-popover';
import * as T from '@radix-ui/react-tooltip';
import * as Tb from '@radix-ui/react-tabs';
import * as Sw from '@radix-ui/react-switch';
import * as M from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, X } from 'lucide-react';
import { forwardRef, useState, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button, inputCls } from './primitives';

// ───────────────────────── Dialog
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, wide, ...p }: Omit<ComponentPropsWithoutRef<typeof D.Content>, 'title'> & { title: ReactNode; description?: ReactNode; wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[70] bg-bg/70 backdrop-blur-sm data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
      <D.Content
        className={cn('panel fixed left-1/2 top-1/2 z-[71] max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-0 shadow-lift data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          wide ? 'max-w-3xl' : 'max-w-lg', className)}
        {...p}
      >
        <div className="flex items-start justify-between gap-3 border-b hairline px-5 py-4">
          <div className="min-w-0">
            <D.Title className="font-display text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-xs text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>}
          </div>
          <D.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X size={15} /></Button></D.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-mx-5 -mb-4 mt-4 flex flex-wrap justify-end gap-2 border-t hairline px-5 py-3', className)}>{children}</div>;
}

/** Left-hand sheet (mobile navigation, filters). */
export function SheetContent({ children, title, className }: { children: ReactNode; title: string; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[70] bg-bg/70 backdrop-blur-sm data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
      <D.Content className={cn('fixed inset-y-0 left-0 z-[71] flex w-[86vw] max-w-[320px] flex-col border-r hairline bg-bg-2 shadow-lift data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out', className)}>
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}

// ───────────────────────── Confirm (destructive operations)
/**
 * Confirmation for operations that cannot be undone. With `typeToConfirm`, the confirm button stays
 * disabled until the user types the phrase (bulk deletes, suspensions, ledger reversals).
 */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = 'Confirm', tone = 'danger', typeToConfirm, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; body: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary'; typeToConfirm?: string; onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }}>
      <DialogContent title={<span className="flex items-center gap-2">{tone === 'danger' && <AlertTriangle size={16} className="text-danger" />}{title}</span>}>
        <div className="text-[13px] text-ink-2">{body}</div>
        {typeToConfirm && (
          <label className="mt-4 block">
            <span className="mb-1 block text-2xs text-ink-3">Type <b className="font-mono text-ink">{typeToConfirm}</b> to confirm</span>
            <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
          <Button size="sm" variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!ok} onClick={() => { onConfirm(); setTyped(''); onOpenChange(false); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Popover
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverContent = forwardRef<ElementRef<typeof P.Content>, ComponentPropsWithoutRef<typeof P.Content>>(function PopoverContent({ className, align = 'start', sideOffset = 6, ...p }, ref) {
  return (
    <P.Portal>
      <P.Content ref={ref} align={align} sideOffset={sideOffset}
        className={cn('z-[80] min-w-[220px] rounded-xl border hairline bg-surface p-1 text-ink shadow-lift outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out', className)} {...p} />
    </P.Portal>
  );
});

// ───────────────────────── Tooltip
export const TooltipProvider = T.Provider;
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[90] max-w-xs rounded-lg border hairline bg-surface px-2.5 py-1.5 text-2xs text-ink shadow-lift data-[state=delayed-open]:animate-pop-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// ───────────────────────── Tabs
export const Tabs = Tb.Root;
export const TabsContent = Tb.Content;
export function TabsList({ tabs, className }: { tabs: { value: string; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <Tb.List className={cn('flex gap-1 overflow-x-auto border-b hairline', className)}>
      {tabs.map((t) => (
        <Tb.Trigger key={t.value} value={t.value}
          className="relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-xs font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:border-primary data-[state=active]:text-ink">
          {t.label}
          {t.count !== undefined && <span className="num rounded-full bg-ink-3/15 px-1.5 text-[10px] text-ink-2">{t.count}</span>}
        </Tb.Trigger>
      ))}
    </Tb.List>
  );
}

// ───────────────────────── Switch
export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <Sw.Root id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border hairline bg-ink-3/25 transition-colors data-[state=checked]:bg-primary">
      <Sw.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}

// ───────────────────────── Dropdown menu
export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className="z-[80] min-w-[200px] rounded-xl border hairline bg-surface p-1 shadow-lift data-[state=open]:animate-pop-in">
        {children}
      </M.Content>
    </M.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, shortcut }: { children: ReactNode; onSelect?: () => void; danger?: boolean; shortcut?: string }) {
  return (
    <M.Item onSelect={onSelect} className={cn('flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-2', danger ? 'text-danger' : 'text-ink')}>
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {shortcut && <kbd className="text-2xs text-ink-3">{shortcut}</kbd>}
    </M.Item>
  );
}
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-ink-3/15" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">{children}</M.Label>;

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border hairline bg-surface-2/60 px-1 font-sans text-[10px] font-semibold text-ink-2', className)}>{children}</kbd>;
}
