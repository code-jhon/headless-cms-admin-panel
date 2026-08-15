import Link from "next/link";

import { currentMilestone } from "@/lib/milestones";
import { cn } from "@/lib/utils";
import type { ContentSchema } from "@/types/cms";

interface SidebarProps {
  schemas: ContentSchema[];
  /** Set when the schema list could not be loaded (e.g. env not configured). */
  error?: string | null;
}

/**
 * Navigation shell. Content types are listed dynamically — nothing here is
 * hard-coded per schema, which is the whole point of the product.
 */
export function Sidebar({ schemas, error }: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface">
      <div className="border-b border-border-subtle px-5 py-4">
        <Link href="/" className="block">
          <span className="block text-sm font-semibold tracking-tight text-ink">
            Headless CMS
          </span>
          <span className="block text-xs text-ink-muted">Admin Panel</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <SectionLabel>Content</SectionLabel>

        {error ? (
          <p className="px-2 py-1.5 text-xs text-ink-muted">Unavailable</p>
        ) : schemas.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-ink-muted">
            No content types yet
          </p>
        ) : (
          <ul className="space-y-0.5">
            {schemas.map((schema) => (
              <li key={schema.id}>
                <NavLink href={`/content/${schema.api_id}`}>
                  {schema.name}
                </NavLink>
              </li>
            ))}
          </ul>
        )}

        <SectionLabel className="mt-6">Configure</SectionLabel>
        <ul className="space-y-0.5">
          <li>
            <NavLink href="/schemas">Schema builder</NavLink>
          </li>
          <li>
            <NavLink href="/health">Health check</NavLink>
          </li>
        </ul>
      </nav>

      <div className="border-t border-border-subtle px-5 py-3">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Milestone {currentMilestone().id} — {currentMilestone().label}
        </p>
      </div>
    </aside>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-md px-2 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
    >
      {children}
    </Link>
  );
}
