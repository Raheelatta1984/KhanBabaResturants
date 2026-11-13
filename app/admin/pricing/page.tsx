import { getDb } from "@/lib/db";
import { getActiveRules, getUpcomingHolidays } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { HolidayManager, PricingRulesEditor, SettingsForm } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const db = getDb();
  const rules = getActiveRules(db);
  const allRules = db.prepare("SELECT * FROM pricing_rules ORDER BY sort_order, id").all() as Parameters<typeof PricingRulesEditor>[0]["rules"];
  const holidays = getUpcomingHolidays(db, 100);
  const pastHolidays = db
    .prepare("SELECT * FROM holidays ORDER BY date DESC LIMIT 20")
    .all() as Parameters<typeof HolidayManager>[0]["holidays"];
  const settings = getSettings();
  void rules;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pricing &amp; holidays</h1>
          <p>
            Surcharges are calculated server-side at checkout. A public holiday replaces the weekend rate; priority is
            never offered to dine-in or table guests.
          </p>
        </div>
        <span className="badge badge-amber">Live rule engine</span>
      </div>

      <PricingRulesEditor rules={allRules} />

      <div style={{ height: 18 }} />
      <HolidayManager holidays={pastHolidays} />

      <div style={{ height: 18 }} />
      <SettingsForm
        values={settings}
        groups={[
          {
            title: "Ordering rules",
            description: "These switches apply to the website, table QR portal and checkout immediately.",
            fields: [
              { key: "table_ordering_enabled", label: "Enable table ordering", type: "toggle" },
              { key: "online_payment_enabled", label: "Accept online payment", type: "toggle" },
              { key: "pay_at_counter_enabled", label: "Allow pay at counter", type: "toggle" },
              { key: "reviews_require_approval", label: "Moderate reviews before publishing", type: "toggle" },
              { key: "priority_base_fee_cents", label: "Standard priority fee", type: "number", suffix: "cents", help: "Used outside peak windows; peak rules override it." },
              { key: "min_order_cents", label: "Minimum order", type: "number", suffix: "cents" },
              { key: "pickup_lead_minutes", label: "Pick-up lead time", type: "number", suffix: "minutes" },
            ],
          },
          {
            title: "Restaurant profile",
            fields: [
              { key: "restaurant_name", label: "Restaurant name" },
              { key: "restaurant_phone", label: "Phone" },
              { key: "restaurant_email", label: "Email" },
              { key: "restaurant_address", label: "Address", type: "textarea" },
              { key: "restaurant_hours", label: "Opening hours", type: "textarea" },
            ],
          },
        ]}
      />

      <div className="notice" style={{ marginTop: 18 }}>
        Upcoming holidays loaded: {holidays.length}. Weekend {settings.timezone} logic uses the Australia/Sydney clock,
        so a 9pm Friday order and a 1am Saturday order are priced correctly.
      </div>
    </>
  );
}
