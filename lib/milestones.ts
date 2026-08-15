/**
 * Delivery progress, in one place.
 *
 * The dashboard roadmap and the sidebar footer both read from here, so
 * finishing a milestone is a one-line change rather than a hunt through
 * components for hardcoded strings.
 *
 * Mirrors §5 of docs/IMPLEMENTATION_STRATEGY.md.
 */
export interface Milestone {
  id: number;
  label: string;
  detail: string;
  done: boolean;
}

export const MILESTONES: Milestone[] = [
  {
    id: 0,
    label: "Foundation",
    detail: "Next.js, Supabase, schema, seed",
    done: true,
  },
  {
    id: 1,
    label: "Schema Builder",
    detail: "Create and edit content types",
    done: true,
  },
  {
    id: 2,
    label: "Dynamic Editor",
    detail: "Forms generated from the schema",
    done: true,
  },
  {
    id: 3,
    label: "Read API",
    detail: "GET /api/content/[type]",
    done: false,
  },
  {
    id: 4,
    label: "Real-time",
    detail: "Every client stays in sync",
    done: false,
  },
  {
    id: 5,
    label: "Schema Evolution",
    detail: "Preview and fix before applying",
    done: false,
  },
];

/** The furthest completed milestone — what the app currently is. */
export function currentMilestone(): Milestone {
  const done = MILESTONES.filter((m) => m.done);
  return done[done.length - 1] ?? MILESTONES[0];
}
