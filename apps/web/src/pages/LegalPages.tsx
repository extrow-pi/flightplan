import type { ReactNode } from "react";
import { Link } from "react-router";
import Logo from "../components/Logo";

// Privacy policy and terms of service. Keep these in step with what the app actually does:
// if you add a data field, a service provider, analytics or payments, update the matching section
// and the "Last updated" date.
const LAST_UPDATED = "September 30, 2026";
const CONTACT_EMAIL = "privacy@jetlaggedcards.ca";
const MAIN_SITE = "https://jetlaggedcards.ca";

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-cream-50">
      <header className="border-b border-ink/5 bg-white/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
          <Logo />
          <nav className="flex gap-4 text-sm font-bold text-ink-soft" aria-label="Legal">
            <Link to="/privacy" className="hover:text-coral-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-coral-ink">
              Terms
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">Last updated {LAST_UPDATED}</p>
        <div className="mt-10 space-y-10 leading-relaxed text-ink-soft [&_a]:font-semibold [&_a]:text-coral-ink [&_a:hover]:underline [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-ink [&_h3]:mt-5 [&_h3]:font-bold [&_h3]:text-ink [&_li]:mt-1.5 [&_p]:mt-3 [&_strong]:text-ink [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-muted">
        Flightplan is a <a href={MAIN_SITE} className="font-semibold text-coral-ink hover:underline">Jetlagged Cards</a>{" "}
        project · Vancouver, BC
      </footer>
    </div>
  );
}

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy">
      <section>
        <p>
          Flightplan is an online tool that helps trading card and collectibles show organizers run their events and
          book vendor tables. It is operated by <strong>Jetlagged Cards</strong>, based in Vancouver, British Columbia
          ("we", "us"). This policy explains what personal information Flightplan collects, why, who it is shared with,
          and the choices you have. We follow Canada's <em>Personal Information Protection and Electronic Documents Act</em>{" "}
          (PIPEDA) and British Columbia's <em>Personal Information Protection Act</em> (PIPA).
        </p>
        <p>
          In short: we collect only what's needed to run shows and bookings, we don't sell your information, and we don't
          use advertising or tracking cookies.
        </p>
      </section>

      <section>
        <h2>Information we collect</h2>

        <h3>Organizers</h3>
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address and password. Passwords are stored only as a
            secure one-way hash, so we can't read them.
          </li>
          <li>
            <strong>If you sign in with Google:</strong> your name, email address and profile picture from your Google
            account. We don't get your Google password or access to anything else in your Google account.
          </li>
          <li>
            <strong>Early-access requests:</strong> if you fill in the early-access form, your name, email, organization,
            city, the kind of events you run, how many you run a year and any message you include.
          </li>
          <li>
            <strong>Your shows:</strong> the events, schedules, table layouts, floor map images, payment instructions and
            templates you create, and your vendor list.
          </li>
          <li>
            <strong>Sign-in records:</strong> when you sign in we record your IP address and browser type with your
            session, to keep your account secure.
          </li>
          <li>
            <strong>Invitations:</strong> when an organizer invites someone to help run a show, we store the invited
            email address and send them an invitation.
          </li>
        </ul>

        <h3>Vendors</h3>
        <ul>
          <li>
            <strong>Booking details:</strong> when you book or request a table, the name, business name, email address,
            phone number and message you enter, which tables you picked, and the status of your booking (for example
            approved, paid or released).
          </li>
          <li>
            <strong>Details an organizer adds:</strong> an organizer may add your contact details themselves, for
            example when assigning you a table or sending you a personal invite link.
          </li>
          <li>
            <strong>Organizer notes:</strong> an organizer can keep private notes about vendors, sort them into groups,
            and mark them as a favourite or on a ban list. Only that organizer can see these, and they're included if
            you ask us for a copy of your information.
          </li>
          <li>
            <strong>Emails about your booking:</strong> we keep a copy of the booking emails we send you, so the
            organizer can see what was sent and resend it if needed.
          </li>
          <li>
            <strong>On your own device:</strong> the booking page can remember your details in your browser to save you
            typing them next time. They stay on your device, and you can clear them by clearing your browser's site data.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <ul>
          <li>To provide Flightplan: running organizer accounts, showing booking pages and managing table bookings.</li>
          <li>
            To send service emails, such as booking confirmations, payment reminders, and notices when a booking changes.
            We don't send marketing emails from Flightplan.
          </li>
          <li>To respond to early-access requests and support questions.</li>
          <li>To keep Flightplan secure, prevent abuse and fix problems.</li>
        </ul>
        <p>
          We don't sell or rent personal information, we don't show ads, and we don't use analytics or tracking tools.
        </p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <ul>
          <li>
            <strong>The show's organizer.</strong> When you book a table, your booking details go to the organizer of that
            show, who uses them to manage the booking and contact you. Organizers are responsible for how they use vendor
            information outside Flightplan, including taking payments, which happen directly between you and the
            organizer.
          </li>
          <li>
            <strong>Other organizers on a shared show.</strong> When organizers run a show together, each of them can see
            the others' names, email addresses and profile pictures, and the show's booking details.
          </li>
          <li>
            <strong>Service providers</strong> that run parts of Flightplan for us, and may use your information only for
            that purpose:
            <ul>
              <li>Microsoft Azure: hosts the app (Canada)</li>
              <li>Supabase: stores the database (Canada)</li>
              <li>Resend: delivers our emails (United States)</li>
              <li>Google: sign-in, only if you choose "Sign in with Google"</li>
            </ul>
          </li>
          <li>
            <strong>When required by law,</strong> for example in response to a valid court order, or to protect the
            safety of people or of Flightplan.
          </li>
        </ul>
      </section>

      <section>
        <h2>Where your information is stored</h2>
        <p>
          Flightplan's app and database are hosted in Canada. Email addresses and the content of emails we send pass
          through Resend in the United States, so they may be subject to U.S. law and accessible to U.S. authorities.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          We use a single essential cookie to keep you signed in. It's required for your account to work and isn't used
          for tracking. We don't use advertising or third-party analytics cookies.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <ul>
          <li>Organizer accounts and show data are kept until you ask us to delete your account.</li>
          <li>
            Vendor booking records are kept as part of the organizer's show records for as long as the organizer's account
            exists, unless you ask us to delete them.
          </li>
          <li>Sign-in records are kept only while the session is active.</li>
          <li>Early-access requests are kept until we've followed up, or until you ask us to remove them.</li>
        </ul>
      </section>

      <section>
        <h2>How we protect it</h2>
        <p>
          All connections to Flightplan are encrypted with HTTPS. Passwords are hashed. Only people who need access to
          run Flightplan can reach the database. No system is perfectly secure, but if a breach puts you at real risk of
          significant harm, we'll tell you and the privacy regulators as the law requires.
        </p>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what personal information we hold about you, and give you a copy;</li>
          <li>correct information that's wrong;</li>
          <li>delete your information or your account;</li>
          <li>stop using your information for a purpose you previously agreed to.</li>
        </ul>
        <p>
          Email <Mail /> and we'll reply within 30 days. We may need to confirm your identity first. If you're a vendor,
          you can also contact the show's organizer directly by replying to any booking email.
        </p>
        <p>
          If you're not satisfied with our answer, you can complain to the{" "}
          <a href="https://www.oipc.bc.ca" target="_blank" rel="noreferrer">
            Office of the Information and Privacy Commissioner for British Columbia
          </a>{" "}
          or the{" "}
          <a href="https://www.priv.gc.ca" target="_blank" rel="noreferrer">
            Office of the Privacy Commissioner of Canada
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          Flightplan is meant for adults who organize or exhibit at shows. It isn't directed at children, and we don't
          knowingly collect personal information from anyone under 13.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          We'll update this page when Flightplan's handling of personal information changes, and change the date at the
          top. If a change is significant, we'll also email organizers.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions or requests about privacy: <Mail />. Jetlagged Cards, Vancouver, British Columbia, Canada.
        </p>
      </section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of service">
      <section>
        <p>
          These terms apply when you use Flightplan, an event tool operated by <strong>Jetlagged Cards</strong> of
          Vancouver, British Columbia ("we", "us"). By creating an account or booking a table through Flightplan, you
          agree to them. Our <Link to="/privacy">privacy policy</Link> explains how we handle personal information.
        </p>
      </section>

      <section>
        <h2>Early access</h2>
        <p>
          Flightplan is in early access. It's free to use for now, and features may change, be added or be removed as we
          build it. If we introduce pricing, we'll tell organizers well in advance, and nothing will be charged without
          your agreement.
        </p>
      </section>

      <section>
        <h2>Organizer accounts</h2>
        <ul>
          <li>You must give accurate information and keep your password secure. You're responsible for activity on your account.</li>
          <li>
            You're responsible for your shows: your event details, table prices, approval decisions and how you deal with
            vendors.
          </li>
          <li>
            <strong>Payments happen outside Flightplan.</strong> Flightplan doesn't process payments. Vendors pay you
            directly using the instructions you provide, and any refunds or disputes are between you and the vendor.
          </li>
          <li>
            Use vendor information only to run your shows and communicate about them, and handle it in line with
            applicable privacy law.
          </li>
        </ul>
      </section>

      <section>
        <h2>Vendors</h2>
        <p>
          When you book or request a table, your arrangement is with the show's organizer, not with us. The organizer
          decides whether to approve your request, sets the price, payment deadline and payment method, and is
          responsible for the event. Contact the organizer, for example by replying to a booking email, about payments,
          refunds or changes.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>Don't use Flightplan to:</p>
        <ul>
          <li>break the law, or promote events that are fraudulent or unlawful;</li>
          <li>send spam, or collect other people's information without their consent;</li>
          <li>upload content you don't have the right to use, or that is offensive or harmful;</li>
          <li>interfere with Flightplan, probe it for weaknesses, or access other people's accounts or data.</li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You keep ownership of what you put into Flightplan, such as event details and floor map images. You give us
          permission to store, display and process it only as needed to run Flightplan for you, for example showing your
          floor map on your booking page.
        </p>
      </section>

      <section>
        <h2>Availability and disclaimer</h2>
        <p>
          We work to keep Flightplan running reliably and your data safe, but it's provided "as is", without guarantees
          that it will always be available or error-free. Keep your own records of important information, such as
          confirmed vendors and payments.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the extent the law allows, we aren't liable for indirect or consequential losses, such as lost profits or
          lost bookings, arising from your use of Flightplan. While Flightplan is free, our total liability to you for any
          claim is limited to CA$100. Nothing in these terms limits rights you have under consumer protection law that
          can't be waived.
        </p>
      </section>

      <section>
        <h2>Suspending or closing accounts</h2>
        <p>
          You can stop using Flightplan at any time and ask us to delete your account by emailing <Mail />. We may suspend
          or close an account that breaks these terms, and we'll tell you why unless the law or safety concerns prevent
          it.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>
          We may update these terms as Flightplan grows. We'll change the date at the top, and email organizers about
          significant changes before they take effect. Continuing to use Flightplan after that means you accept the
          updated terms.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of British Columbia and the federal laws of Canada that apply there. Any
          dispute will be handled by the courts of British Columbia.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: <Mail />. Jetlagged Cards, Vancouver, British Columbia, Canada.
        </p>
      </section>
    </LegalLayout>
  );
}
