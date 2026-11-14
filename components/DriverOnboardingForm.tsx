"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./Icon";

const STEPS = [
  { title: "About you", blurb: "Name, contact and where you are based" },
  { title: "Vehicle & licence", blurb: "What you will deliver with" },
  { title: "Verification", blurb: "References for our compliance checks" },
  { title: "Agreements", blurb: "Terms, privacy and your delivery area" },
];

const DOCUMENTS: { key: string; label: string; placeholder: string }[] = [
  { key: "photo_id", label: "Photo ID", placeholder: "Passport / photo card number" },
  { key: "licence", label: "Driver licence", placeholder: "Licence number" },
  { key: "insurance", label: "Vehicle insurance", placeholder: "Policy number" },
  { key: "police_check", label: "National police check", placeholder: "Check reference (or 'pending')" },
  { key: "right_to_work", label: "Right to work", placeholder: "Visa / citizenship reference" },
  { key: "abn", label: "ABN", placeholder: "11 digit ABN" },
  { key: "bank", label: "Bank / PayID", placeholder: "PayID email or mobile (payouts only)" },
];

/** State-of-the-art driver onboarding: staged, explicit and auditable. */
export function DriverOnboardingForm() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ code: string } | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean | number | null>>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    suburb: "",
    postcode: "",
    vehicleType: "car",
    vehicleRego: "",
    vehicleMake: "",
    licenceNumber: "",
    licenceState: "NSW",
    licenceExpiry: "",
    insuranceProvider: "",
    insuranceExpiry: "",
    abn: "",
    rightToWorkCountry: "Australia",
    policeCheckRef: "",
    payId: "",
    maxRadiusKm: 15,
    notes: "",
    termsAccepted: false,
    privacyAccepted: false,
    baseLat: null,
    baseLng: null,
  });
  const [documents, setDocuments] = useState<Record<string, string>>({});

  function set(key: string, value: string | boolean | number | null) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        set("baseLat", position.coords.latitude);
        set("baseLng", position.coords.longitude);
      },
      () => set("notes", "Location permission declined — team will confirm the base area."),
      { timeout: 8000 },
    );
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/driver/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, documents }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not submit the application");
      setDone({ code: data.code ?? "" });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel" style={{ textAlign: "center", padding: 36 }}>
        <div className="empty" style={{ border: 0, background: "none" }}>
          <div className="icon"><Icon name="check" size={28} /></div>
          <h3>Application received</h3>
          <p className="small">
            Your reference is <b className="mono">{done.code}</b>. Our delivery
            team will verify each document, then send your private driver portal
            link with live tracking and your ATO kilometre history.
          </p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 18 }}>
            Back to the restaurant
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="wizard-steps">
        {STEPS.map((entry, index) => (
          <button
            key={entry.title}
            type="button"
            className="wizard-step"
            data-active={step === index ? "true" : "false"}
            data-done={step > index ? "true" : "false"}
            onClick={() => index < step && setStep(index)}
          >
            <span className="step-number">{step > index ? "✓" : index + 1}</span>
            <span>
              <b>{entry.title}</b>
              <small>{entry.blurb}</small>
            </span>
          </button>
        ))}
      </div>

      {step === 0 ? (
        <div className="form-grid">
          <div className="field"><span className="label">First name</span><input className="input" value={String(form.firstName)} onChange={(e) => set("firstName", e.target.value)} required /></div>
          <div className="field"><span className="label">Last name</span><input className="input" value={String(form.lastName)} onChange={(e) => set("lastName", e.target.value)} required /></div>
          <div className="field"><span className="label">Email</span><input className="input" type="email" value={String(form.email)} onChange={(e) => set("email", e.target.value)} required /></div>
          <div className="field"><span className="label">Mobile</span><input className="input" inputMode="tel" value={String(form.phone)} onChange={(e) => set("phone", e.target.value)} required /></div>
          <div className="field full"><span className="label">Street address</span><input className="input" value={String(form.address)} onChange={(e) => set("address", e.target.value)} /></div>
          <div className="field"><span className="label">Suburb</span><input className="input" value={String(form.suburb)} onChange={(e) => set("suburb", e.target.value)} /></div>
          <div className="field"><span className="label">Postcode</span><input className="input" value={String(form.postcode)} onChange={(e) => set("postcode", e.target.value)} /></div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="form-grid">
          <div className="field">
            <span className="label">Vehicle type</span>
            <select className="select" value={String(form.vehicleType)} onChange={(e) => set("vehicleType", e.target.value)}>
              <option value="car">Car</option><option value="motorbike">Motorbike / scooter</option>
              <option value="bicycle">Bicycle</option><option value="van">Van</option>
            </select>
          </div>
          <div className="field"><span className="label">Registration</span><input className="input" value={String(form.vehicleRego)} onChange={(e) => set("vehicleRego", e.target.value)} /></div>
          <div className="field"><span className="label">Make &amp; model</span><input className="input" value={String(form.vehicleMake)} onChange={(e) => set("vehicleMake", e.target.value)} /></div>
          <div className="field"><span className="label">Licence number</span><input className="input" value={String(form.licenceNumber)} onChange={(e) => set("licenceNumber", e.target.value)} /></div>
          <div className="field"><span className="label">Licence state</span><input className="input" value={String(form.licenceState)} onChange={(e) => set("licenceState", e.target.value)} /></div>
          <div className="field"><span className="label">Licence expiry</span><input className="input" type="date" value={String(form.licenceExpiry)} onChange={(e) => set("licenceExpiry", e.target.value)} /></div>
          <div className="field"><span className="label">Insurer</span><input className="input" value={String(form.insuranceProvider)} onChange={(e) => set("insuranceProvider", e.target.value)} /></div>
          <div className="field"><span className="label">Insurance expiry</span><input className="input" type="date" value={String(form.insuranceExpiry)} onChange={(e) => set("insuranceExpiry", e.target.value)} /></div>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <div className="notice" style={{ marginBottom: 16 }}>
            <Icon name="shield" size={15} />
            <span>
              Enter the reference numbers for each check. A coordinator verifies
              every item individually before you can be dispatched — documents
              are never stored on a public URL.
            </span>
          </div>
          <div className="form-grid">
            {DOCUMENTS.map((doc) => (
              <div className="field" key={doc.key}>
                <span className="label">{doc.label}</span>
                <input
                  className="input"
                  placeholder={doc.placeholder}
                  value={documents[doc.key] ?? ""}
                  onChange={(e) => setDocuments((current) => ({ ...current, [doc.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="field"><span className="label">ABN (sole trader)</span><input className="input" value={String(form.abn)} onChange={(e) => set("abn", e.target.value)} /></div>
            <div className="field"><span className="label">Right to work — country</span><input className="input" value={String(form.rightToWorkCountry)} onChange={(e) => set("rightToWorkCountry", e.target.value)} /></div>
            <div className="field"><span className="label">PayID for commission payouts</span><input className="input" value={String(form.payId)} onChange={(e) => set("payId", e.target.value)} /></div>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div className="form-grid">
            <div className="field">
              <span className="label">Maximum delivery radius (km)</span>
              <input className="input" type="number" min="1" max="100" value={Number(form.maxRadiusKm)} onChange={(e) => set("maxRadiusKm", Number(e.target.value))} />
            </div>
            <div className="field">
              <span className="label">Starting point for dispatch</span>
              <button type="button" className="btn btn-outline" onClick={locate}>
                <Icon name="pin" size={14} />{" "}
                {form.baseLat ? `${Number(form.baseLat).toFixed(4)}, ${Number(form.baseLng).toFixed(4)}` : "Use my current location"}
              </button>
            </div>
            <div className="field full">
              <span className="label">Anything we should know?</span>
              <textarea className="input" rows={3} value={String(form.notes)} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <label className="check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={Boolean(form.termsAccepted)} onChange={(e) => set("termsAccepted", e.target.checked)} />
            I accept the driver partner terms: commission and delivery fees are
            posted on successful deliveries, and I am responsible for my own
            tax, insurance and vehicle costs.
          </label>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={Boolean(form.privacyAccepted)} onChange={(e) => set("privacyAccepted", e.target.checked)} />
            I consent to location sharing while on an active delivery and to the
            verification of the documents listed above (privacy policy).
          </label>
        </>
      ) : null}

      {error ? <div className="notice notice-red" style={{ marginTop: 14 }}>{error}</div> : null}

      <div className="row" style={{ marginTop: 22, justifyContent: "space-between" }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={step === 0 || busy}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep((current) => current + 1)}>
            Continue <Icon name="arrow" size={15} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !form.termsAccepted || !form.privacyAccepted}>
            {busy ? "Submitting…" : "Submit application"}
          </button>
        )}
      </div>
    </div>
  );
}
