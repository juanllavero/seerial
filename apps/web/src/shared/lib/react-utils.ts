import { toast } from 'sonner';

type ToastType = 'success' | 'error' | 'info' | 'warning';

type ToastPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';

export function showToast(
    type: ToastType,
    message: string,
    description?: string,
    duration?: number,
    position?: ToastPosition,
): void {
    const options = {
        ...(description ? { description } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(position ? { position } : {}),
    };
    toast[type](message, options);
}

export function generateRandoumUUID(): string {
    return crypto.randomUUID();
}
