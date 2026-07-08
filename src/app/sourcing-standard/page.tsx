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
        Every guide in our knowledge base carries two pieces of metadata:{" "}
        <code>last_verified</code>, the date a human last checked its citations
        against the current regulation and VA guidance, and{" "}
        <code>volatility</code>, an honest label for how likely that guide is to
        go stale (regulation text is stable; contractor rosters and
        processing-time figures drift). We would rather tell you a guide is due
        for a recheck than let it quietly go out of date.
      </p>
    </main>
  );
}
