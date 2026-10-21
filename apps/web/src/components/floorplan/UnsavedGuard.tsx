import { useEffect } from "react";
import { useBlocker } from "react-router";

/** Ask before leaving with unsaved changes (in-app navigation and closing the tab). */
export default function UnsavedGuard({ dirty, message = "You have unsaved changes to this floorplan. Leave without saving?" }: { dirty: boolean; message?: string }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  return null;
}
