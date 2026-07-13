// Interim monetization surface (GTM/monetization Phase 0, see
// docs/superpowers/findings/2026-07-13-product-strategy-synthesis.md §3 & §6):
// a donation link and a $4.99/mo Founding Supporter tier, both shippable with
// zero Document Workspace dependency. Both links come from env vars rather
// than being hardcoded because they point at Stripe Payment Links created in
// the Stripe dashboard -- there's no live Stripe account wired into this repo
// yet, so this page renders a "coming soon" state until those are set.
const donationLink = process.env.NEXT_PUBLIC_DONATION_LINK;
const foundingSupporterLink = process.env.NEXT_PUBLIC_FOUNDING_SUPPORTER_LINK;

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 data-testid="support-heading">Support This Project</h1>
      <p>
        This is an independent project built to help veterans understand the VA
        disability claims process -- not a VSO, and not a substitute for one.
        Every answer is grounded in the actual regulation or a cited source; we
        never guess.
      </p>

      <section className="mt-8">
        <h2>Make a donation</h2>
        <p>
          If this has been useful to you, a one-time or recurring donation helps
          cover hosting and model costs and keeps the core Knowledge Assistant
          free for every veteran who needs it.
        </p>
        {donationLink ? (
          <a href={donationLink} data-testid="donation-link">
            Donate
          </a>
        ) : (
          <p data-testid="donation-coming-soon">
            Donations aren&apos;t open yet -- check back soon.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2>Founding Supporter -- $4.99/mo</h2>
        <ul>
          <li>Unlimited Knowledge Assistant messages (no monthly cap)</li>
          <li>Priority model for faster, higher-quality answers</li>
          <li>
            A founding badge, and grandfathered pricing once the paid Plus tier
            ships
          </li>
        </ul>
        <p>
          This tier only affects the Knowledge Assistant chat you already have
          access to -- it isn&apos;t gating anything back from the free tier,
          it&apos;s removing the free tier&apos;s monthly message cap.
        </p>
        {foundingSupporterLink ? (
          <>
            <a
              href={foundingSupporterLink}
              data-testid="founding-supporter-link"
            >
              Become a Founding Supporter
            </a>
            <p>
              After paying, email us the address you used so we can activate
              your account -- this is a manual step until automatic activation
              ships.
            </p>
          </>
        ) : (
          <p data-testid="founding-supporter-coming-soon">
            Founding Supporter sign-up isn&apos;t open yet -- check back soon.
          </p>
        )}
      </section>
    </main>
  );
}
