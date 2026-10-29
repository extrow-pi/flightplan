import { useUnsavedChanges } from "../../pages/dashboard/ui";

/** Ask before leaving with unsaved changes: our own dialog in the app, the browser's when closing the tab. */
export default function UnsavedGuard({ dirty }: { dirty: boolean }) {
  return useUnsavedChanges(dirty).dialog;
}
