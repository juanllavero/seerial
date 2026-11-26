import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion';
import { useNavigate } from 'react-router';
import { NavigationButton, NavigationContainer } from '@/shared/components/navigation';

export interface TopBarSubmenuItem {
  /** Also its focus key. */
  id: string;
  label: string;
  path: string;
}

interface LibrariesListProps {
  items: TopBarSubmenuItem[];
  show: boolean;
  hide: () => void;
  hideWithoutFocusRestore: () => void;
}

function LibrariesList({ items, show, hide, hideWithoutFocusRestore }: LibrariesListProps) {
  const navigate = useNavigate();

  return (
    <LazyMotion features={domAnimation}>
      <NavigationContainer className="fixed z-50 flex justify-center items-center top-10 w-screen px-25">
        <AnimatePresence>
          {show && (
            <m.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeInOut' }}
              className="flex justify-center overflow-x-auto p-3 rounded-xl gap-2"
            >
              {items.map((item) => (
                <NavigationButton
                  key={item.id}
                  customKey={item.id}
                  onArrowPress={(direction) => {
                    if (direction === 'up') {
                      hide();
                      return false;
                    }

                    if (direction === 'down') {
                      hideWithoutFocusRestore();
                    }

                    return true;
                  }}
                  onClick={() => {
                    hide();
                    navigate(item.path);
                  }}
                  text={item.label}
                  variant="ghost"
                />
              ))}
            </m.div>
          )}
        </AnimatePresence>
      </NavigationContainer>
    </LazyMotion>
  );
}

export default LibrariesList;
