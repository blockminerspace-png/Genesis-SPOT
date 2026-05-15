type VoidFn = () => void;

let authLostHandler: VoidFn | null = null;

export function setDashboardAuthLostHandler(fn: VoidFn | null): void {
  authLostHandler = fn;
}

/** Chamado quando um `fetch` à API devolve 401 (ex.: cookie expirado). */
export function notifyDashboardAuthLost(): void {
  authLostHandler?.();
}
