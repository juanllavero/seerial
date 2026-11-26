import { Suspense } from 'react';
import { type DialogType, dialogRegistry } from './dialog-registry';

interface DynamicDialogProps {
  type: DialogType;
  isOpen: boolean;
}

function DynamicDialog({ type, isOpen }: DynamicDialogProps) {
  const DialogComponent = isOpen ? dialogRegistry[type] : null;

  if (!isOpen || !DialogComponent) return null;

  // The lazy ones suspend while they download: without a boundary React keeps waiting silently
  return (
    <Suspense fallback={null}>
      <DialogComponent />
    </Suspense>
  );
}

export default DynamicDialog;
