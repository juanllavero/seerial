import { Check } from 'lucide-react';
import { NavigationButton } from '@/shared/components/navigation';

/** Keeps the focused row visible: spatial navigation does not scroll by itself. */
export function scrollFocusedRowIntoView(focusKey: string) {
  document.querySelector(`[data-focus-key="${focusKey}"]`)?.scrollIntoView({ block: 'nearest' });
}

/** Shared look of the rows of the menus (overrides the size and radius of the button). */
export const MENU_ROW_CLASS =
  'mb-[0.6dvh] h-auto max-h-none! w-full shrink-0 justify-start! whitespace-normal! rounded-[1.4dvh]! px-[1.8dvh]! py-[1.4dvh]! text-left hover:ring-2 hover:ring-white/50';

/** A selectable row: audio and subtitle tracks, in the player and in the details screens. */
export default function MenuRow({
  focusKey,
  label,
  detail,
  badges = [],
  isSelected = false,
  onClick,
}: {
  focusKey: string;
  label: string;
  detail?: string;
  badges?: string[];
  isSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <NavigationButton
      variant="ghost"
      selected={isSelected}
      customKey={focusKey}
      className={`${MENU_ROW_CLASS} ${isSelected ? 'ring-2 ring-app-color' : ''}`}
      onClick={onClick}
      onFocus={() => scrollFocusedRowIntoView(focusKey)}
    >
      {/* divs: a global rule colours every span, which would not follow the focus colour */}
      <div className="flex w-full items-center gap-[1.4dvh]">
        <div className="flex w-[2.4dvh] shrink-0 justify-center">
          {!!isSelected && <Check className="size-[2.4dvh]!" strokeWidth={3} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="block font-semibold text-[2dvh] leading-snug">{label}</div>
          {!!detail && (
            <div className="wrap-break-word mt-[0.3dvh] block text-[1.6dvh] leading-snug opacity-75">
              {detail}
            </div>
          )}
        </div>
        {badges.map((badge) => (
          <div
            key={badge}
            className="shrink-0 rounded-[0.6dvh] border border-current px-[0.7dvh] py-[0.2dvh] font-semibold text-[1.3dvh] uppercase opacity-80"
          >
            {badge}
          </div>
        ))}
      </div>
    </NavigationButton>
  );
}
