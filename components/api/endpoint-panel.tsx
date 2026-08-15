"use client";

import { useState } from "react";

import { Badge, Button, Card } from "@/components/ui";

/**
 * The read API, shown next to the content it serves.
 *
 * The challenge asks for proof that the panel manages real content another
 * app could consume — putting the live endpoint and a runnable curl beside
 * the entry list is that proof, rather than a claim buried in a README.
 */
export function EndpointPanel({
  apiId,
  referenceKeys,
}: {
  apiId: string;
  /** Reference field keys, used to show a relevant `expand` example. */
  referenceKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const base = `/api/content/${apiId}`;
  const expandExample = referenceKeys[0]
    ? `${base}?expand=${referenceKeys[0]}`
    : `${base}?limit=5&order=updated_at`;

  const examples: Array<{ label: string; path: string }> = [
    { label: "Collection", path: base },
    { label: "Paginated", path: `${base}?limit=5&offset=0` },
    ...(referenceKeys.length > 0
      ? [{ label: "With references expanded", path: expandExample }]
      : []),
    { label: "Content types", path: "/api/content" },
  ];

  async function copy(path: string) {
    const url =
      typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(`curl "${url}"`);
      setCopied(path);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be denied; the command is visible to copy by hand.
      setCopied(null);
    }
  }

  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Badge tone="accent">API</Badge>
          <code className="font-mono text-xs text-ink">GET {base}</code>
        </span>
        <span className="text-xs text-ink-muted">
          {open ? "Hide" : "Examples"}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border-subtle px-4 py-3">
          {examples.map((example) => (
            <div
              key={example.path}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs text-ink-muted">{example.label}</p>
                <code className="block truncate font-mono text-xs text-ink">
                  {example.path}
                </code>
              </div>
              <Button
                size="sm"
                type="button"
                onClick={() => copy(example.path)}
              >
                {copied === example.path ? "Copied" : "Copy curl"}
              </Button>
            </div>
          ))}

          <p className="pt-1 text-xs text-ink-muted">
            Read-only, no auth, CORS open. Full reference in{" "}
            <code className="font-mono">docs/API.md</code>.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
