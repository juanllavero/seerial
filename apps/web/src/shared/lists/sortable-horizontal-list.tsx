import HorizontalList from './horizontal-list';
import { SortableGrid } from './sortable-grid';

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
 * SortableGrid (items need its SortableListContext, which SortableGrid provides).
 */
export function SortableHorizontalList<T extends SortableEntity>({
  title,
  items,
  onDragEnd,
  renderItem,
}: SortableHorizontalListProps<T>) {
  return (
    <HorizontalList title={title}>
      <SortableGrid items={items} onDragEnd={onDragEnd} renderItem={renderItem} />
    </HorizontalList>
  );
}
