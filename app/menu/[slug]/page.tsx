import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getItemReviews, getMenuItem, getRelatedItems } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { ItemOrderPanel } from "@/components/ItemOrderPanel";
import { ReviewForm } from "@/components/ReviewForm";
import { DishCard } from "@/components/DishCard";
import { Icon } from "@/components/Icon";
import { SectionHead, SPICE_INFO, Stars } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const item = getMenuItem(slug);
  if (!item) return { title: "Dish not found" };
  return {
    title: item.name,
    description: item.description ?? undefined,
    openGraph: { title: item.name, description: item.description ?? undefined, images: [item.image] },
  };
}

export default async function ItemPage({ params }: Params) {
  const { slug } = await params;
  const item = getMenuItem(slug);
  if (!item) notFound();

  const reviews = getItemReviews(item.id);
  const related = getRelatedItems(item, 3);
  const settings = getSettings();
  const cheapest = Math.min(...item.variants.map((variant) => variant.priceCents));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.name,
    description: item.description,
    image: item.image,
    offers: {
      "@type": "Offer",
      priceCurrency: "AUD",
      price: (cheapest / 100).toFixed(2),
      availability: item.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
    ...(item.rating.count > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: item.rating.avg, reviewCount: item.rating.count } }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="section-tight" style={{ paddingTop: 32 }}>
        <div className="container">
          <nav className="tiny muted" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
            <Link href="/">Home</Link> <span>/</span>
            <Link href="/menu">Menu</Link> <span>/</span>
            <span style={{ color: "var(--text)" }}>{item.name}</span>
          </nav>

          <div className="item-hero">
            <div className="item-gallery">
              <div className="main">
                <img src={item.image} alt={item.name} />
              </div>
              {item.youtubeId ? (
                <div className="item-video">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${item.youtubeId}?rel=0&modestbranding=1`}
                    title={`${item.name} — kitchen video`}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
              ) : null}
              <div className="grid grid-2" style={{ marginTop: 14, gap: 12 }}>
                <div className="card" style={{ padding: 14 }}>
                  <div className="tiny muted">Prep time</div>
                  <div className="strong" style={{ marginTop: 4 }}>
                    <Icon name="clock" size={14} /> {item.prepMinutes} minutes
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <div className="tiny muted">Service</div>
                  <div className="small strong" style={{ marginTop: 4 }}>
                    Delivery · Pick-up · Dine in
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span className="badge badge-amber">{item.categoryName}</span>
                {item.isVeg ? <span className="badge badge-green">Vegetarian</span> : <span className="badge">Halal</span>}
                {item.isNew ? <span className="badge badge-blue">New</span> : null}
              </div>
              <h1 className="item-title">{item.name}</h1>
              <p className="small" style={{ color: "var(--accent)", letterSpacing: "0.05em", textTransform: "uppercase", fontSize: "0.74rem" }}>
                {item.tagline}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
                {item.rating.count > 0 ? <Stars rating={item.rating.avg} count={item.rating.count} /> : <span className="tiny muted">No reviews yet — be the first</span>}
                <span className="tiny muted">· {item.variants.length} size option{item.variants.length > 1 ? "s" : ""}</span>
              </div>

              <p className="item-desc" style={{ marginTop: 18 }}>
                {item.description}
              </p>

              <div className="item-price-row">
                <span className="item-price">{cheapest / 100 >= 1 ? `$${(cheapest / 100).toFixed(2)}` : ""}</span>
                <span className="tiny muted">{item.variants.length > 1 ? "for the smaller size · larger available" : "per portion · GST included"}</span>
              </div>

              <ItemOrderPanel item={item} />

              <div className="ingredient-panel">
                <div className="rowline">
                  <b>Ingredients</b>
                  <span>{item.ingredients.length > 0 ? item.ingredients.join(" · ") : "Ask our team for the full ingredient list"}</span>
                </div>
                <div className="rowline">
                  <b>Allergens</b>
                  <span style={{ color: item.allergens.length > 0 && item.allergens[0] !== "None" ? "var(--red)" : "var(--muted)" }}>
                    {item.allergens.length > 0 ? item.allergens.join(", ") : "None declared"}
                  </span>
                </div>
                {item.spiceLevels.length > 0 ? (
                  <div className="rowline">
                    <b>Spice options</b>
                    <span>{item.spiceLevels.map((level) => SPICE_INFO[level]?.label ?? level).join(" · ")}</span>
                  </div>
                ) : null}
                <div className="rowline">
                  <b>Kitchen</b>
                  <span>100% halal · cooked to order · no MSG</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--bg-soft)", borderBlock: "1px solid var(--line)" }}>
        <div className="container">
          <div className="grid grid-2" style={{ alignItems: "start", gap: 40 }}>
            <div>
              <SectionHead eyebrow="Guest reviews" title={`What people say about the ${item.name.toLowerCase()}`} />
              {reviews.length === 0 ? (
                <p className="muted small">No reviews published yet. Ordered this dish? Tell us how it was.</p>
              ) : (
                <div>
                  {reviews.map((review) => (
                    <article key={review.id} className="review">
                      <div className="review-head">
                        <span className="avatar">{review.customerName.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <div className="small strong">{review.customerName}</div>
                          <div className="tiny" style={{ color: "var(--muted-2)" }}>
                            {formatDateTime(review.createdAt)}
                          </div>
                        </div>
                        <div style={{ marginLeft: "auto" }}>
                          <Stars rating={review.rating} />
                        </div>
                      </div>
                      <p className="small muted">{review.comment}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <ReviewForm itemId={item.id} requireApproval={settings.reviews_require_approval === "1"} />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead eyebrow="Goes well with" title="Complete the table" action={<Link href="/menu" className="btn btn-outline btn-sm">Full menu</Link>} />
          <div className="grid grid-3">
            {related.map((entry) => (
              <DishCard key={entry.id} item={entry} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
