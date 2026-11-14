import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { MusicStudio } from "@/components/portal/MusicStudio";
import { SettingsForm } from "@/components/portal/AdminForms";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "Music system" };

/**
 * Music management for the administrator.
 *
 * The library, collections, schedules and live controls are the same component
 * the counter uses; this page adds the house rules — default volume, the
 * on-demand charging rules, and the respect switch that keeps music out of a
 * religious set.
 */
export default async function AdminMusicPage() {
  const settings = await getSettings();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Music system</h1>
          <p>
            Load music, religious recitations and collections, schedule them by day and time, and
            control the shared player. Guests can request a song with a link; the counter approves it
            and may charge nothing or adjust the amount.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/counter/music" className="btn btn-outline btn-sm">
            <Icon name="play" size={14} /> Counter music desk
          </Link>
          <Link href="/music" className="btn btn-ghost btn-sm">
            <Icon name="eye" size={14} /> Guest view
          </Link>
        </div>
      </div>

      <MusicStudio />

      <div style={{ marginTop: 22 }}>
        <SettingsForm
          values={settings}
          groups={[
            {
              title: "House music rules",
              description:
                "Volume is capped in the player at a deliberately quiet 60% and defaults to 20%. Customers can always mute on their own device; the room control belongs to the counter and admin.",
              fields: [
                { key: "music_enabled", label: "Music system on", type: "toggle" },
                { key: "theme_lahore", label: "Lahore cultural theme on the website", type: "toggle" },
                { key: "music_default_volume", label: "Default room volume", type: "number", suffix: "%" },
                {
                  key: "music_pause_during_religious",
                  label: "Never play music over a religious set",
                  type: "toggle",
                  help: "Ambience and the table-order thank-you stay silent while a naat, hamd or recitation is playing.",
                },
                { key: "music_encouragement_enabled", label: "Acknowledge table orders with the room", type: "toggle" },
                { key: "music_now_playing_note", label: "Now-playing note", type: "textarea" },
              ],
            },
            {
              title: "On-demand song charging",
              description:
                "These are the pre-ruled amounts. At approval the counter sees the suggested charge and can set it to zero, lower it or raise it — nothing is charged without their press.",
              fields: [
                { key: "music_request_enabled", label: "Accept guest requests", type: "toggle" },
                { key: "music_request_requires_approval", label: "Require staff approval", type: "toggle" },
                { key: "music_request_base_charge_cents", label: "Standard charge", type: "number", suffix: "cents" },
                { key: "music_request_peak_charge_cents", label: "Peak-hours charge", type: "number", suffix: "cents" },
                { key: "music_request_peak_start", label: "Peak starts", type: "text", help: "HH:MM, restaurant time" },
                { key: "music_request_peak_end", label: "Peak ends", type: "text" },
                { key: "music_request_free_allowed", label: "Staff may waive the charge", type: "toggle" },
                { key: "music_request_max_minutes", label: "Max on-demand run", type: "number", suffix: "minutes" },
              ],
            },
            {
              title: "Dine-in settlement and feedback",
              description:
                "The house rule: a guest at a table pays at the counter after the meal. The counter parks the ticket until the payment clears, then the feedback link goes out.",
              fields: [
                { key: "dine_in_pay_at_counter_only", label: "Table and dine-in orders pay at the counter only", type: "toggle" },
                { key: "table_park_on_ready", label: "Park automatically when served", type: "toggle" },
                { key: "feedback_enabled", label: "Send feedback links", type: "toggle" },
                { key: "feedback_auto_on_table_settle", label: "Send feedback after a table settles", type: "toggle" },
                { key: "feedback_google_place_id", label: "Google place id", type: "text" },
                { key: "feedback_google_url", label: "Google review URL", type: "text" },
                { key: "feedback_bill_range_percent", label: "Bill range in the review", type: "number", suffix: "% either way" },
                { key: "feedback_min_rating_to_publish", label: "Minimum rating for a Google draft", type: "number" },
              ],
            },
          ]}
        />
      </div>
    </>
  );
}
