import { useLayoutEffect, useRef, useState } from 'react';

type DialogSession = { pending: boolean };

/** A reopened editor is a new draft, even when its object is unchanged. */
export function useDialogSession(open: boolean, identity?: string | number | null) {
  const ownerRef = useRef<DialogSession | null>(null);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    ownerRef.current = open ? { pending: false } : null;
    setSaving(false);
    return () => { ownerRef.current = null; };
  }, [open, identity]);

  const isCurrent = (owner: DialogSession | null) => owner !== null && ownerRef.current === owner;
  return {
    saving,
    capture: () => ownerRef.current,
    isCurrent,
    begin: () => {
      const owner = ownerRef.current;
      if (!owner || owner.pending) return null;
      owner.pending = true;
      setSaving(true);
      return owner;
    },
    finish: (owner: DialogSession) => {
      if (!isCurrent(owner)) return;
      owner.pending = false;
      setSaving(false);
    },
  };
}
