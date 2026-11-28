import HorizontalList from './horizontal-list';
import { SortableProvider } from './sortable-grid';
import { SortableItem } from './sortable-item';

interface SortableEntity {
  id: string;
}

interface SortableHorizontalListProps<T extends SortableEntity> {
  title: string;
  items: T[];
  onDragEnd: (sourceIndex: number, destinationIndex: number) => void;
  renderItem: (item: T) => React.ReactNode;
}

/**
 * Horizontal list whose items can be reordered by dragging. It shares the drag engine of
 * SortableGrid. Each item is its own slide, so with the mouse dragging reorders and the list is
 * moved with its buttons; with touch, swiping moves the list.
 */
export function SortableHorizontalList<T extends SortableEntity>({
  title,
  items,
  onDragEnd,
  renderItem,
}: SortableHorizontalListProps<T>) {
  return (
    <SortableProvider items={items} onDragEnd={onDragEnd} renderItem={renderItem}>
      <HorizontalList title={title} disableMouseDrag>
        {items.map((item, index) => (
          <SortableItem key={item.id} id={item.id} index={index} ignoreTouch>
            {renderItem(item)}
          </SortableItem>
        ))}
      </HorizontalList>
    </SortableProvider>
  );
}
