import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion';
import type { ReactNode } from 'react';
import { NavigationContainer } from '@/shared/components/navigation';

/** Panel that opens above a player button. Sized in dvh to be readable from the sofa. */
export default function PlayerMenu({
  open,
  title,
  hint,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {!!open && (
          <>
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="fixed inset-0 z-40 bg-black/50"
              onClick={onClose}
            />
            <NavigationContainer
              isFocusBoundary
              className="absolute right-0 bottom-full z-50 mb-[2dvh] w-[min(68dvh,90vw)]"
            >
              <m.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex max-h-[72dvh] flex-col overflow-hidden rounded-[2.4dvh] border border-white/15 bg-neutral-950/95 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-white/10 border-b px-[2.6dvh] py-[1.8dvh]">
                  <div className="font-semibold text-[2.6dvh] text-white leading-tight">
                    {title}
                  </div>
                  {!!hint && <div className="mt-[0.4dvh] text-[1.5dvh] text-white/60">{hint}</div>}
                </div>
                <div className="min-h-0 overflow-y-auto p-[1.2dvh]">{children}</div>
              </m.div>
            </NavigationContainer>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
