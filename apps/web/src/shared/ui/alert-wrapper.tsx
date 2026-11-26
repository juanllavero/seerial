import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

interface AlertWrapperProps {
  title: string;
  description: string;
  actionMessage: string;
  /** May return a promise: the button then shows a loader and ignores clicks until it settles. */
  action: () => void | Promise<void>;
  openDialog?: boolean;
  isDeleteAlert?: boolean;
  closeDialog: () => void;
}

function AlertWrapper({
  title,
  description,
  actionMessage,
  action,
  isDeleteAlert,
  openDialog,
  closeDialog,
}: AlertWrapperProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={openDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={closeDialog}>{t('cancelButton')}</AlertDialogCancel>
          <AlertDialogAction onClick={action} className={isDeleteAlert ? 'bg-red-500 hover:bg-red-600' : ''}>
            {actionMessage}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default AlertWrapper;
