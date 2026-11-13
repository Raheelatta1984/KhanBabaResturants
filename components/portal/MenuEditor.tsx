"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/money";
import { parseYouTubeId } from "@/lib/youtube";
import { Icon } from "../Icon";

type Category = { id: number; name: string };

type Variant = {
  id?: number;
  label: string;
  sizeMl: string;
  price: string;
  isDefault: boolean;
};

export type EditorItem = {
  id?: number;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  categoryId: number | null;
  image: string;
  youtube: string;
  ingredients: string;
  allergens: string;
  spiceLevels: string[];
  prepMinutes: number;
  isVeg: boolean;
  isAvailable: boolean;
  isFeatured: boolean;
  isNew: boolean;
  published: boolean;
  variants: Variant[];
};

const SPICE_OPTIONS = [
  ["blend", "Blend"],
  ["mild", "Mild"],
  ["hot", "Hot"],
  ["extra_hot", "Extra hot"],
];

export function MenuEditor({ categories, initial }: { categories: Category[]; initial: EditorItem }) {
  const router = useRouter();
  const [item, setItem] = useState<EditorItem>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  function update<K extends keyof EditorItem>(key: K, value: EditorItem[K]) {
    setItem((current) => ({ ...current, [key]: value }));
  }

  function updateVariant(index: number, patch: Partial<Variant>) {
    setItem((current) => ({
      ...current,
      variants: current.variants.map((variant, position) => (position === index ? { ...variant, ...patch } : variant)),
    }));
  }

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/ops/upload", { method: "POST", body: form });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Upload failed");
      update("image", data.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save(publish?: boolean) {
    setBusy(true);
    setError("");
    try {
      const payload = {
        action: "save",
        id: item.id,
        item: {
          name: item.name,
          slug: item.slug,
          tagline: item.tagline,
          description: item.description,
          categoryId: item.categoryId,
          image: item.image,
          youtube: item.youtube,
          ingredients: item.ingredients,
          allergens: item.allergens,
          spiceLevels: item.spiceLevels,
          prepMinutes: item.prepMinutes,
          isVeg: item.isVeg,
          isAvailable: item.isAvailable,
          isFeatured: item.isFeatured,
          isNew: item.isNew,
          published: publish === undefined ? item.published : publish,
        },
        variants: item.variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          sizeMl: variant.sizeMl ? Number(variant.sizeMl) : null,
          priceCents: Math.round(Number(variant.price) * 100),
          isDefault: variant.isDefault,
        })),
      };
      const response = await fetch("/api/ops/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string; id?: number };
      if (!response.ok) throw new Error(data.error || "Could not save the dish");
      router.push("/admin/menu");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save");
      setBusy(false);
    }
  }

  const youtubeId = parseYouTubeId(item.youtube);

  return (
    <div className="grid" style={{ gap: 18, gridTemplateColumns: "1fr" }}>
      <section className="panel">
        <div className="panel-head">
          <h3>Dish details</h3>
          <span className="tiny muted">Everything here is customer-facing</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="label">Dish name *</span>
            <input className="input" value={item.name} onChange={(event) => update("name", event.target.value)} placeholder="Chicken Biryani" />
          </div>
          <div className="field">
            <span className="label">URL slug</span>
            <input className="input" value={item.slug} onChange={(event) => update("slug", event.target.value)} placeholder="chicken-biryani" />
          </div>
          <div className="field">
            <span className="label">Tagline</span>
            <input className="input" value={item.tagline} onChange={(event) => update("tagline", event.target.value)} placeholder="The house signature" />
          </div>
          <div className="field">
            <span className="label">Category</span>
            <select className="select" value={item.categoryId ?? ""} onChange={(event) => update("categoryId", event.target.value ? Number(event.target.value) : null)}>
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <span className="label">Description</span>
            <textarea className="textarea" value={item.description} onChange={(event) => update("description", event.target.value)} placeholder="What makes this dish special…" />
          </div>
          <div className="field">
            <span className="label">Ingredients (comma separated)</span>
            <textarea className="textarea" style={{ minHeight: 70 }} value={item.ingredients} onChange={(event) => update("ingredients", event.target.value)} />
          </div>
          <div className="field">
            <span className="label">Allergens (comma separated)</span>
            <textarea className="textarea" style={{ minHeight: 70 }} value={item.allergens} onChange={(event) => update("allergens", event.target.value)} placeholder="Milk, tree nuts" />
          </div>
          <div className="field">
            <span className="label">Prep time (minutes)</span>
            <input className="input" type="number" min={1} max={180} value={item.prepMinutes} onChange={(event) => update("prepMinutes", Number(event.target.value))} />
          </div>
          <div className="field">
            <span className="label">Flags</span>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 6 }}>
              <label className="check"><input type="checkbox" checked={item.isVeg} onChange={(event) => update("isVeg", event.target.checked)} /> Vegetarian</label>
              <label className="check"><input type="checkbox" checked={item.isFeatured} onChange={(event) => update("isFeatured", event.target.checked)} /> Featured</label>
              <label className="check"><input type="checkbox" checked={item.isNew} onChange={(event) => update("isNew", event.target.checked)} /> New</label>
              <label className="check"><input type="checkbox" checked={item.isAvailable} onChange={(event) => update("isAvailable", event.target.checked)} /> Available</label>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Sizes &amp; pricing</h3>
          <span className="tiny muted">Biryani and curries typically offer 500 ml and 1000 ml</span>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {item.variants.map((variant, index) => (
            <div key={index} className="form-row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 2, minWidth: 140 }}>
                <span className="label">Label</span>
                <input className="input" value={variant.label} onChange={(event) => updateVariant(index, { label: event.target.value })} placeholder="500 ml" />
              </div>
              <div className="field" style={{ width: 120 }}>
                <span className="label">Size (ml)</span>
                <input className="input" type="number" value={variant.sizeMl} onChange={(event) => updateVariant(index, { sizeMl: event.target.value })} placeholder="500" />
              </div>
              <div className="field" style={{ width: 130 }}>
                <span className="label">Price (AUD)</span>
                <input className="input" type="number" step="0.01" value={variant.price} onChange={(event) => updateVariant(index, { price: event.target.value })} placeholder="15.99" />
              </div>
              <label className="check" style={{ paddingBottom: 12 }}>
                <input
                  type="radio"
                  name="default-variant"
                  checked={variant.isDefault}
                  onChange={() =>
                    setItem((current) => ({
                      ...current,
                      variants: current.variants.map((entry, position) => ({ ...entry, isDefault: position === index })),
                    }))
                  }
                />
                Default
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginBottom: 4 }}
                onClick={() => setItem((current) => ({ ...current, variants: current.variants.filter((_, position) => position !== index) }))}
                disabled={item.variants.length <= 1}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ marginTop: 12 }}
          onClick={() =>
            setItem((current) => ({
              ...current,
              variants: [...current.variants, { label: "", sizeMl: "", price: "", isDefault: false }],
            }))
          }
        >
          <Icon name="plus" size={13} /> Add another size
        </button>

        <div className="option-block" style={{ marginTop: 20 }}>
          <span className="label">Spice levels offered</span>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 6 }}>
            {SPICE_OPTIONS.map(([value, label]) => (
              <label className="check" key={value}>
                <input
                  type="checkbox"
                  checked={item.spiceLevels.includes(value)}
                  onChange={(event) =>
                    update(
                      "spiceLevels",
                      event.target.checked
                        ? [...item.spiceLevels, value]
                        : item.spiceLevels.filter((level) => level !== value),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Leave all unchecked for dishes without a heat choice (breads, drinks, desserts).
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Photography &amp; video</h3>
          <span className="tiny muted">YouTube plays inline via the privacy-enhanced player</span>
        </div>
        <div className="grid grid-2" style={{ gap: 18 }}>
          <div>
            <div style={{ aspectRatio: "4 / 3", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
              {item.image ? <img src={item.image} alt="Dish preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <span className="label">Image URL</span>
              <input className="input" value={item.image} onChange={(event) => update("image", event.target.value)} placeholder="/images/dish.jpg or /api/media/…" />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <span className="label">Upload a photo (JPG, PNG, WebP — max 6 MB)</span>
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              {uploading ? <span className="tiny muted">Uploading…</span> : null}
            </div>
          </div>
          <div>
            <div className="field">
              <span className="label">YouTube link or video ID</span>
              <input className="input" value={item.youtube} onChange={(event) => update("youtube", event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
            </div>
            {youtubeId ? (
              <div className="item-video" style={{ marginTop: 12 }}>
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
                  title="Dish video preview"
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="notice" style={{ marginTop: 12 }}>
                <Icon name="play" size={14} />
                <span>Paste a YouTube URL to preview the inline player. No third-party scripts are loaded on the site.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {error ? <div className="notice notice-red">{error}</div> : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
          {busy ? "Saving…" : item.id ? "Save changes" : "Create dish"}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => save(false)} disabled={busy}>
          Save as draft
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => router.push("/admin/menu")}>
          Cancel
        </button>
        <span className="tiny muted" style={{ marginLeft: "auto" }}>
          First size price: {money(Math.round(Number(item.variants[0]?.price || 0) * 100))}
        </span>
      </div>
    </div>
  );
}
