import { sortCollectionItems } from '@/api/v1/collections/domain/sortCollectionItems';

const names = (items: { name: string }[]) => items.map((item) => item.name);

describe('sortCollectionItems', () => {
  it('goes from the oldest to the newest by default, without year at the end', () => {
    const items = [
      { name: 'unknown', year: '', collectionOrder: 0 },
      { name: 'new', year: '1985-06-01', collectionOrder: 0 },
      { name: 'old', year: '1950-08-26', collectionOrder: 0 },
    ];

    expect(names(sortCollectionItems(items))).toEqual(['old', 'new', 'unknown']);
  });

  it('keeps the order of the user and puts the items added later after it', () => {
    const items = [
      { name: 'added later', year: '1900', collectionOrder: 0 },
      { name: 'second', year: '1950', collectionOrder: 2 },
      { name: 'first', year: '1985', collectionOrder: 1 },
    ];

    expect(names(sortCollectionItems(items))).toEqual(['first', 'second', 'added later']);
  });
});
