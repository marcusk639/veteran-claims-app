interface CitationPillProps {
  source: string;
  section: string;
}

export function CitationPill({ source, section }: CitationPillProps) {
  const label = section ? `${source} § ${section}` : source;
  return (
    <span
      data-testid="citation-pill"
      className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
    >
      {label}
    </span>
  );
}
