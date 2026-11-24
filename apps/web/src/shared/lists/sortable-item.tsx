import { createContext, useContext, useRef } from 'react';

export interface SortableListContextValue {
  sourceIndex: number | null;
  targetIndex: number | null;
  pointerPosition: { x: number; y: number } | null;
  draggedRect: { width: number; height: number } | null;
  beginDrag: (
    sourceIndex: number,
    pointerPosition: { x: number; y: number },
    draggedRect: { width: number; height: number },
  ) => void;
  updateDrag: (payload: {
    pointerPosition: { x: number; y: number };
    targetIndex: number | null;
  }) => void;
  endDrag: () => void;
}

export const SortableListContext = createContext<SortableListContextValue | null>(null);

export function useSortableListContext() {
  const context = useContext(SortableListContext);

  if (!context) {
    throw new Error('useSortableListContext must be used within SortableListContext');
  }

  return context;
}

interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  index: number;
}

/** Pixels the pointer must travel before a press becomes a drag (below that it is a plain click). */
const DRAG_THRESHOLD_PX = 6;

export function SortableItem({ id, children, index }: SortableItemProps) {
  const { sourceIndex, targetIndex, beginDrag } = useSortableListContext();
  const dragStartedRef = useRef(false);
  const isDragging = sourceIndex === index;
  const showTargetMarker = targetIndex === index && sourceIndex !== index;

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.15 : 1,
    position: 'relative',
    cursor: isDragging ? 'grabbing' : 'grab',
    transform: isDragging ? 'scale(0.98)' : 'scale(1)',
    transition: 'transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease',
    userSelect: 'none',
    boxShadow: showTargetMarker ? '0 0 0 2px rgba(255, 255, 255, 0.45) inset' : 'none',
    borderRadius: '0.75rem',
  };

  return (
    <div
      data-sortable-item-id={id}
      data-sortable-item-index={index}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragStartedRef.current = false;

        const rect = event.currentTarget.getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY };

        // Only start dragging once the pointer really moves: capturing the pointer right away
        // redirects the click to this wrapper and the card inside never receives it.
        const cleanup = () => {
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', cleanup);
          window.removeEventListener('pointercancel', cleanup);
        };
        const handleMove = (moveEvent: PointerEvent) => {
          if (
            Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD_PX
          ) {
            return;
          }
          cleanup();
          dragStartedRef.current = true;
          beginDrag(
            index,
            { x: moveEvent.clientX, y: moveEvent.clientY },
            { width: rect.width, height: rect.height },
          );
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
      }}
      // A drag must not also open the item it started on
      onClickCapture={(event) => {
        if (dragStartedRef.current) {
          event.stopPropagation();
          event.preventDefault();
          dragStartedRef.current = false;
        }
      }}
      onDragStart={(event) => event.preventDefault()}
      style={style}
    >
      {children}
    </div>
  );
}
