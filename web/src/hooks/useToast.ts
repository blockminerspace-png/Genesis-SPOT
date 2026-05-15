import { useCallback, useRef, useState } from "react";

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" | "muted" } | null>(null);
  const tref = useRef<number>(0);
  const show = useCallback((msg: string, kind: "ok" | "err" | "muted" = "muted") => {
    window.clearTimeout(tref.current);
    setToast({ msg, kind });
    if (msg) {
      tref.current = window.setTimeout(() => setToast(null), 5000);
    }
  }, []);
  return { toast, show };
}
