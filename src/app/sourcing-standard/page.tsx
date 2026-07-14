export default function SourcingStandardPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 data-testid="sourcing-standard-heading">Our Sourcing Standard</h1>
      <p>
        Every answer the Knowledge Assistant gives is grounded in a specific,
        cited source -- either the official regulation (38 CFR Part 4) or a
        curated guide from our knowledge base. We never answer from unverified
        model knowledge.
      </p>
      <p>
        Internally, every guide in our knowledge base is tagged with{" "}
        <code>last_verified</code> (the date a human last checked its content
        against the current regulation and VA guidance) and{" "}
        <code>volatility</code> (how likely that guide is to go stale --
        regulation text is stable; contractor rosters and processing-time
        figures drift). Our content team uses these tags to decide what to
        recheck and when. They&rsquo;re a curation practice, not a per-answer
        readout -- an individual citation in the chat doesn&rsquo;t currently
        carry its own freshness label.
      </p>
    </main>
  );
}
