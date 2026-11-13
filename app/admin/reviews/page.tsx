import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { ReviewRowActions } from "@/components/portal/AdminForms";
import { Stars } from "@/components/ui";

export const dynamic = "force-dynamic";

type Review = {
  id: number;
  item_id: number;
  item_name: string;
  slug: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  status: string;
  created_at: string;
};

export default async function AdminReviewsPage() {
  const db = await getDb();
  const rows = await db.query<Review>(
    `SELECT r.*, mi.name AS item_name, mi.slug FROM reviews r JOIN menu_items mi ON mi.id = r.item_id
     ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, r.created_at DESC
     LIMIT 100`,
  );

  const pending = rows.filter((row) => row.status === "pending");
  const rest = rows.filter((row) => row.status !== "pending");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reviews</h1>
          <p>
            Moderate guest feedback before it appears on the dish page. Ratings
            feed the menu average.
          </p>
        </div>
        <span className="badge badge-amber">
          {pending.length} awaiting moderation
        </span>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Awaiting approval</h3>
        </div>
        {pending.length === 0 ? (
          <p className="small muted">Nothing to moderate.</p>
        ) : (
          pending.map((review) => (
            <div key={review.id} className="review">
              <div className="review-head">
                <span className="avatar">
                  {review.customer_name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <div className="small strong">
                    {review.customer_name} · {review.item_name}
                  </div>
                  <div className="tiny muted">
                    {formatDateTime(review.created_at)}
                  </div>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  <Stars rating={review.rating} />
                </div>
              </div>
              <p className="small muted">{review.comment}</p>
              <ReviewRowActions id={review.id} />
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Published &amp; hidden</h3>
          <span className="tiny muted">{rest.length} reviews</span>
        </div>
        {rest.map((review) => (
          <div key={review.id} className="review">
            <div className="review-head">
              <span className="avatar">
                {review.customer_name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div className="small strong">
                  {review.customer_name} · {review.item_name}{" "}
                  <span
                    className={`badge ${review.status === "published" ? "badge-green" : "badge-muted"}`}
                  >
                    {review.status}
                  </span>
                </div>
                <div className="tiny muted">
                  {formatDateTime(review.created_at)}
                </div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <Stars rating={review.rating} />
              </div>
            </div>
            <p className="small muted">{review.comment}</p>
            <ReviewRowActions id={review.id} />
          </div>
        ))}
        {rest.length === 0 ? (
          <p className="small muted">No published reviews yet.</p>
        ) : null}
      </section>
    </>
  );
}
