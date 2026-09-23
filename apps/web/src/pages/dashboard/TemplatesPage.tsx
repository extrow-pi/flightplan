import { Link } from "react-router";
import { isTemplate, TemplateRow } from "../../components/events";
import { CopyIcon, PlusIcon } from "../../components/Icons";
import { useEvents } from "../../lib/api";
import { ErrorCard, LoadingCards, PageHeader } from "./ui";

export default function TemplatesPage() {
  const { data, isPending, error } = useEvents();
  const templates = data?.filter(isTemplate) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title="Show templates"
        subtitle="Reusable show setups: days and hours, venue, tables and prices. Use one to start a new draft in seconds."
        action={
          <Link
            to="/dashboard/templates/new"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 border-coral px-6 py-3 whitespace-nowrap font-bold text-coral-ink transition hover:bg-coral hover:text-white"
          >
            <PlusIcon className="size-4" strokeWidth={3} />
            New template
          </Link>
        }
      />

      {error ? (
        <ErrorCard message={error.message} />
      ) : isPending ? (
        <LoadingCards />
      ) : templates.length ? (
        <ul className="space-y-3">
          {templates.map((t) => (
            <TemplateRow key={t.id} event={t} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-coral/30 bg-white px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-peach text-coral-ink">
            <CopyIcon className="size-7" />
          </span>
          <p className="mt-4 text-lg font-extrabold">No templates yet</p>
          <p className="mt-2 max-w-md text-ink-soft">
            Run the same kind of show often? Open any event and choose <strong>Save as template</strong>, or build one
            from scratch.
          </p>
          <Link
            to="/dashboard/templates/new"
            className="mt-5 rounded-full bg-coral px-6 py-3 font-bold text-white transition hover:bg-coral-deep"
          >
            Create a template
          </Link>
        </div>
      )}
    </>
  );
}
