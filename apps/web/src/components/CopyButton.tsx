import { useState } from "react";
import { CopyIcon } from "./Icons";

/** Copy text (usually a link) to the clipboard, falling back to a prompt where clipboard access is blocked. */
export default function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
      className="btn btn-secondary inline-flex items-center gap-1.5 px-3 py-1 text-sm"
    >
      <CopyIcon className="size-3.5" />
      {copied ? "Copied!" : label}
    </button>
  );
}
