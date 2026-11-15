"use client";
import Link from "next/link";
import { useState } from "react";

type Dish = { slug: string; name: string; isVeg: boolean; spiceLevels: string[]; categoryName: string };
export function MenuGuide({ items, phone }: { items: Dish[]; phone: string }) {
  const [vegetarian, setVegetarian] = useState("any");
  const [spice, setSpice] = useState("any");
  const [category, setCategory] = useState("any");
  const [submitted, setSubmitted] = useState(false);
  const categories = [...new Set(items.map((item) => item.categoryName).filter(Boolean))].sort();
  const levels = [...new Set(items.flatMap((item) => item.spiceLevels).filter(Boolean))].sort();
  const matches = items.filter((item) => (vegetarian !== "veg" || item.isVeg) && (category === "any" || item.categoryName === category) && (spice === "any" || item.spiceLevels.some((level) => level.toLowerCase() === spice.toLowerCase())));
  return <div className="container-narrow section">
    <span className="eyebrow">A little help choosing</span>
    <h1>Find your next favourite</h1>
    <p className="muted" style={{ margin: "18px 0" }}>Tell us what you enjoy and this menu guide will suggest available dishes. This is a simple matching tool, not an AI chat. Your choices stay on this page and are not saved.</p>
    <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} style={{ display: "grid", gap: 16, maxWidth: 520 }}>
      <label>Diet preference<br /><select value={vegetarian} onChange={(e) => setVegetarian(e.target.value)}><option value="any">Anything</option><option value="veg">Vegetarian</option></select></label>
      <label>Spice level<br /><select value={spice} onChange={(e) => setSpice(e.target.value)}><option value="any">Any</option>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
      <label>What are you interested in?<br /><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="any">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button className="btn btn-primary" type="submit">Show suggestions</button>
    </form>
    {submitted && <section aria-live="polite" style={{ marginTop: 32 }}><h2>Suggestions</h2>{matches.length ? <ul>{matches.slice(0, 8).map((item) => <li key={item.slug}><Link href={`/menu/${encodeURIComponent(item.slug)}`}>{item.name} →</Link></li>)}</ul> : <p>No exact matches. Try a different preference or browse the full menu.</p>}</section>}
    <p style={{ marginTop: 28 }}>Allergies or dietary requirements? Please speak to our team before ordering; menu matches are not an allergen guarantee.</p>
    <p style={{ marginTop: 12 }}><a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>Call the restaurant: {phone}</a> · <Link href="/menu">Browse the full menu</Link></p>
  </div>;
}
