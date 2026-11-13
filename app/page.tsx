import Link from "next/link";
import QRCode from "qrcode";
import { getDb } from "@/lib/db";
import { getFeaturedItems, getRecentReviews, menuSummary } from "@/lib/catalog";
import { money } from "@/lib/money";
import { getUpcomingHolidays } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { getBaseUrl } from "@/lib/url";
import { DishCard } from "@/components/DishCard";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";
import { SectionHead, Stars } from "@/components/ui";

export const dynamic = "force-dynamic";

const SERVICES = [
  {
    icon: "bike",
    title: "Delivery",
    body: "Live Uber Direct courier quotes at checkout, so you see the real fee before you pay. Dispatched the moment your food is packed.",
    link: "/menu?mode=delivery",
    cta: "Order delivery",
  },
  {
    icon: "bag",
    title: "Click & collect",
    body: "Skip the queue. Order ahead, we cook it fresh and you collect from the counter on Pitt Street.",
    link: "/menu?mode=pickup",
    cta: "Order for pickup",
  },
  {
    icon: "table",
    title: "Dine in & table ordering",
    body: "Scan the QR on your table, order straight to the kitchen and watch preparation progress from your phone.",
    link: "/table/T04",
    cta: "Try table ordering",
  },
];

const STEPS = [
  { title: "You order", body: "Delivery, pick-up or from your table — choose container size and heat level.", pct: 10 },
  { title: "Counter confirms", body: "Our team accepts the ticket and it lands on the kitchen display instantly.", pct: 25 },
  { title: "Kitchen cooks", body: "Every item is ticked off as it is prepared. You see the percentage climb.", pct: 65 },
  { title: "Packed & dispatched", body: "Courier request is triggered with the live quote, or your table is served.", pct: 92 },
];

export default async function HomePage() {
  const db = getDb();
  const featured = getFeaturedItems(db, 4);
  const summary = menuSummary(db);
  const reviews = getRecentReviews(db, 3);
  const settings = getSettings();
  const holidays = getUpcomingHolidays(db, 3);
  const updates = db
    .prepare("SELECT title, summary, category, published_at FROM whats_new ORDER BY pinned DESC, datetime(published_at) DESC LIMIT 3")
    .all() as { title: string; summary: string; category: string; published_at: string }[];
  const baseUrl = await getBaseUrl();
  const qrSvg = await QRCode.toString(`${baseUrl}/table/T04`, {
    type: "svg",
    margin: 1,
    width: 180,
    color: { dark: "#0a0908", light: "#ffffff" },
  });
  const cheapest = featured.length
    ? Math.min(...featured.map((item) => Math.min(...item.variants.map((v) => v.priceCents))))
    : 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: settings.restaurant_name,
    servesCuisine: ["Pakistani", "Indian", "Halal"],
    priceRange: "$$",
    telephone: settings.restaurant_phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: settings.restaurant_address,
      addressLocality: "Sydney",
      addressRegion: "NSW",
      postalCode: settings.restaurant_postcode,
      addressCountry: "AU",
    },
    image: `${baseUrl}/images/feast.jpg`,
    url: baseUrl,
    acceptsReservations: true,
    aggregateRating: { "@type": "AggregateRating", ratingValue: summary.rating, reviewCount: Math.max(summary.reviews, 8) },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Lahore → Sydney · Halal kitchen</span>
            <h1>
              Same taste from Lahore to <em>Sydney</em>.
            </h1>
            <p className="hero-lede">
              Biryani sealed on dum, karahi fired to order and naan straight from the tandoor — now ordered direct from
              our kitchen. Delivery, click &amp; collect, dine-in or straight from your table.
            </p>

            <div className="hero-cta">
              <Link href="/menu" className="btn btn-primary">
                Order now <Icon name="arrow" size={17} />
              </Link>
              <Link href="#how" className="btn btn-outline">
                How ordering works
              </Link>
            </div>

            <div className="hero-meta">
              <div>
                <strong>{summary.rating.toFixed(1)}★</strong>
                <span>Guest rating</span>
              </div>
              <div>
                <strong>{summary.dishes}</strong>
                <span>Dishes on the menu</span>
              </div>
              <div>
                <strong>{money(cheapest)}+</strong>
                <span>From the tandoor</span>
              </div>
              <div>
                <strong>30–45</strong>
                <span>Min delivery</span>
              </div>
            </div>
          </div>

          <div className="hero-visual">
            <div className="frame">
              <img src="/images/feast.jpg" alt="A Khan Baba table spread of biryani, karahi and naan" />
            </div>
            <span className="hero-tag">
              <span className="live-dot" /> Kitchen live now
            </span>
            <div className="hero-float">
              <div className="row">
                <span className="tiny muted">Order KB-DEMO02 · Table 4</span>
                <span className="badge badge-amber">47%</span>
              </div>
              <div className="bar">
                <i />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="tiny strong">Butter Chicken ready</span>
                <span className="tiny muted">Garlic naan next</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} style={{ display: "flex", gap: 46 }}>
              {[
                "100% halal",
                "Baked to order",
                "Live courier quotes",
                "500 ml & 1 L tubs",
                "Spice level you choose",
                "No aggregator commission",
                "Table QR ordering",
              ].map((label) => (
                <span key={`${copy}-${label}`}>{label}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="section" id="services">
        <div className="container">
          <Reveal>
            <SectionHead
              eyebrow="Three ways to order"
              title="Direct from the kitchen, however you want it."
              description="One menu, one kitchen, three service modes. Every order is confirmed by our counter team before it hits the pass."
              action={
                <Link href="/menu" className="btn btn-outline btn-sm">
                  Browse menu <Icon name="arrow" size={14} />
                </Link>
              }
            />
          </Reveal>
          <div className="grid grid-3">
            {SERVICES.map((service, index) => (
              <Reveal key={service.title} delay={index * 80}>
                <article className="card card-hover feature-card" style={{ height: "100%" }}>
                  <span className="icon">
                    <Icon name={service.icon} size={20} />
                  </span>
                  <h3>{service.title}</h3>
                  <p>{service.body}</p>
                  <Link href={service.link} className="link">
                    {service.cta} →
                  </Link>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="notice" style={{ marginTop: 20 }}>
              <Icon name="shield" size={16} />
              <span>
                Transparent pricing: a <b>5% weekend</b> and <b>10% public holiday</b> surcharge is shown line-by-line at
                checkout. Priority preparation is optional for delivery and pick-up only — never for table guests.
                {holidays[0] ? ` Next holiday: ${holidays[0].name} on ${formatDate(holidays[0].date)}.` : ""}
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section" style={{ background: "rgba(255,255,255,0.012)", borderBlock: "1px solid var(--line)" }}>
        <div className="container">
          <Reveal>
            <SectionHead
              eyebrow="From our tandoor"
              title="The dishes Sydney keeps coming back for."
              description="Pick a size, choose your heat, see exactly what is in it. Every dish is cooked after you order."
              action={
                <Link href="/menu" className="btn btn-outline btn-sm">
                  Full menu
                </Link>
              }
            />
          </Reveal>
          <div className="grid grid-4">
            {featured.map((item, index) => (
              <Reveal key={item.id} delay={index * 60}>
                <DishCard item={item} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="story">
        <div className="container">
          <div className="grid grid-2" style={{ alignItems: "center", gap: "clamp(28px, 5vw, 64px)" }}>
            <Reveal>
              <div style={{ borderRadius: 24, overflow: "hidden", border: "1px solid var(--line-strong)", position: "relative" }}>
                <img src="/images/interior-2.jpg" alt="Inside Khan Baba Restaurant in Sydney" style={{ aspectRatio: "5 / 4", objectFit: "cover" }} />
                <div style={{ position: "absolute", bottom: 18, left: 18, background: "rgba(10,9,8,0.8)", backdropFilter: "blur(10px)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line-strong)" }}>
                  <div className="tiny muted">Pitt Street, Sydney CBD</div>
                  <div className="small strong">Open 7 days · Dine in & takeaway</div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <span className="eyebrow">Our story</span>
              <h2 style={{ margin: "16px 0 18px" }}>A decade of feeding Sydney, one karahi at a time.</h2>
              <p className="muted">
                Khan Baba began with one tandoor and a family recipe book. Ten years on, we still cook the same way:
                fresh ingredients, whole spices ground in-house, and everything made to order. What has changed is how
                you get it.
              </p>
              <div className="grid grid-2" style={{ marginTop: 26, gap: 14 }}>
                {[
                  ["Fresh, never frozen", "Produce delivered daily from Flemington."],
                  ["Halal certified", "Every cut sourced from certified suppliers."],
                  ["Cooked to order", "No bain-maries, no reheating."],
                  ["Direct pricing", "No aggregator commission baked into your bill."],
                ].map(([title, body]) => (
                  <div key={title} style={{ display: "flex", gap: 10 }}>
                    <span style={{ color: "var(--green)", marginTop: 2 }}>
                      <Icon name="check" size={16} />
                    </span>
                    <div>
                      <div className="small strong">{title}</div>
                      <div className="tiny muted">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section" id="how" style={{ background: "var(--bg-soft)", borderBlock: "1px solid var(--line)" }}>
        <div className="container">
          <Reveal>
            <SectionHead
              eyebrow="Zero mystery"
              title="You see the kitchen work."
              description="Every order follows the same tracked path. The progress you see is the progress our team sees."
            />
          </Reveal>
          <div className="grid grid-4">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delay={index * 80}>
                <div className="card" style={{ height: "100%", position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="badge badge-amber">{step.pct}%</span>
                    <span className="tiny" style={{ color: "var(--muted-2)" }}>
                      0{index + 1}
                    </span>
                  </div>
                  <h3 style={{ margin: "14px 0 8px", fontSize: "1.18rem" }}>{step.title}</h3>
                  <p className="small muted">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={140}>
            <div className="card" style={{ marginTop: 22, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center" }}>
              <div className="qr-wrap" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div>
                <span className="eyebrow">At the table</span>
                <h3 style={{ margin: "12px 0 8px" }}>Scan. Order. Watch it cook.</h3>
                <p className="small muted" style={{ maxWidth: "60ch" }}>
                  Every table has its own QR code. Orders go to the counter for confirmation, then straight to the kitchen
                  with a live completion percentage on your phone. Pay online or settle at the counter on your way out.
                </p>
              </div>
              <Link href="/table/T04" className="btn btn-primary">
                Open Table 4 menu <Icon name="arrow" size={15} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <Reveal>
            <SectionHead
              eyebrow="What's new"
              title="The restaurant, in software."
              description="New portals, menu changes and fixes ship continuously. Every release lands here."
              action={
                <Link href="/whats-new" className="btn btn-outline btn-sm">
                  Release feed
                </Link>
              }
            />
          </Reveal>
          <div className="grid grid-3">
            {updates.map((update, index) => (
              <Reveal key={update.title} delay={index * 70}>
                <Link href="/whats-new" className="card card-hover" style={{ display: "block", height: "100%" }}>
                  <span className={`badge ${update.category === "feature" ? "badge-amber" : "badge-blue"}`}>{update.category}</span>
                  <h3 style={{ margin: "14px 0 8px", fontSize: "1.16rem" }}>{update.title}</h3>
                  <p className="small muted">{update.summary}</p>
                  <span className="tiny" style={{ color: "var(--muted-2)", display: "block", marginTop: 14 }}>
                    {formatDateTime(update.published_at)}
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="grid grid-3">
            {reviews.map((review, index) => (
              <Reveal key={review.id} delay={index * 70}>
                <figure className="card" style={{ height: "100%", margin: 0 }}>
                  <Stars rating={review.rating} />
                  <blockquote style={{ margin: "12px 0 16px", fontFamily: "var(--font-display)", fontSize: "1.12rem", lineHeight: 1.4 }}>
                    “{review.comment}”
                  </blockquote>
                  <figcaption className="tiny muted">
                    {review.customer_name} · <Link href={`/menu/${review.slug}`} style={{ color: "var(--accent)" }}>{review.item_name}</Link>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <Reveal>
            <div
              style={{
                borderRadius: 28,
                padding: "clamp(28px, 5vw, 54px)",
                background:
                  "radial-gradient(700px 300px at 15% 0%, rgba(243,171,63,0.22), transparent 70%), linear-gradient(135deg, #1b1611, #120f0c)",
                border: "1px solid rgba(243,171,63,0.24)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 28,
                flexWrap: "wrap",
              }}
            >
              <div>
                <span className="eyebrow">Hungry yet?</span>
                <h2 style={{ margin: "12px 0 8px" }}>Order direct. Skip the commission.</h2>
                <p className="muted small" style={{ maxWidth: "52ch" }}>
                  Ordering straight from us means better prices, a real kitchen tracking your food and a courier quote you
                  can see before you pay.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/menu" className="btn btn-primary">
                  Start an order <Icon name="arrow" size={16} />
                </Link>
                <Link href="/table/T04" className="btn btn-outline">
                  I&apos;m at a table
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
