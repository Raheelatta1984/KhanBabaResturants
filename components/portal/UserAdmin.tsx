"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABELS, type Role } from "@/lib/auth/core";
import { formatDateTime } from "@/lib/time";
import { Message, useSave } from "./AdminForms";

const ROLE_ORDER: Role[] = ["counter", "kitchen", "delivery", "manager", "admin"];

const ROLE_ACCESS: Record<Role, string> = {
  admin: "Everything, including administrators and going live",
  manager: "Admin console and every portal, but not administrator accounts",
  counter: "Counter portal and customer lookup",
  kitchen: "Kitchen display",
  delivery: "Delivery coordination",
};

/** A random password that is easy to read aloud: no 0/O, 1/l/I. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const value of bytes) out += alphabet[value % alphabet.length];
  return out;
}

/**
 * A password box shown in plain text on purpose: the person typing it is
 * setting it for someone else and has to pass it on.
 */
function NewPasswordInput({
  value,
  onChange,
  width = 210,
}: {
  value: string;
  onChange: (value: string) => void;
  width?: number | string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        style={{ width, fontFamily: "ui-monospace, monospace" }}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="At least 8 characters"
        aria-label="New password"
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange(generatePassword())}
      >
        Generate
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- staff */

export type StaffRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
};

export function StaffManager({
  staff,
  currentId,
  currentRole,
  demoIds,
}: {
  staff: StaffRow[];
  currentId: number;
  currentRole: Role;
  /** Accounts whose password is still the published demo password. */
  demoIds: number[];
}) {
  const isAdmin = currentRole === "admin";
  const assignable = ROLE_ORDER.filter((role) => isAdmin || role !== "admin");
  const blank = { name: "", email: "", role: "counter" as Role, password: "" };
  const [form, setForm] = useState(blank);
  const [panel, setPanel] = useState<{
    id: number;
    kind: "edit" | "password" | "delete";
  } | null>(null);
  const [edit, setEdit] = useState({ name: "", email: "", role: "counter" as Role });
  const [newPassword, setNewPassword] = useState("");
  const { busy, message, save } = useSave();
  const rowSave = useSave();

  function open(member: StaffRow, kind: "edit" | "password" | "delete") {
    if (panel?.id === member.id && panel.kind === kind) {
      setPanel(null);
      return;
    }
    setPanel({ id: member.id, kind });
    setEdit({ name: member.name, email: member.email, role: member.role });
    setNewPassword("");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>Add a team member</h3>
          <span className="tiny muted">
            The role decides which portals they can open
          </span>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="field">
            <span className="label">Sign-in email</span>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>
          <div className="field">
            <span className="label">Role</span>
            <select
              className="select"
              value={form.role}
              onChange={(event) =>
                setForm({ ...form, role: event.target.value as Role })
              }
            >
              {assignable.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <span className="tiny muted">{ROLE_ACCESS[form.role]}</span>
          </div>
          <div className="field">
            <span className="label">Temporary password</span>
            <NewPasswordInput
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              width="100%"
            />
            <span className="tiny muted">
              Pass it on, then ask them to change it under “My password”.
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              const ok = await save(
                "/api/ops/staff",
                { action: "create", ...form },
                `Account created for ${form.email}`,
              );
              if (ok) setForm(blank);
            }}
          >
            Create account
          </button>
          <Message message={message} />
        </div>
      </section>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sign-in email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const isSelf = member.id === currentId;
              // Managers can see administrators but not change them.
              const locked = !isAdmin && member.role === "admin";
              const openKind = panel?.id === member.id ? panel.kind : null;
              return (
                <tr key={member.id}>
                  <td>
                    <b>{member.name}</b>
                    {isSelf ? <div className="tiny muted">you</div> : null}
                  </td>
                  <td className="tiny">{member.email}</td>
                  <td>
                    <span className="tag">{ROLE_LABELS[member.role]}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${member.active ? "badge-green" : "badge-muted"}`}
                    >
                      {member.active ? "Active" : "Disabled"}
                    </span>
                    {demoIds.includes(member.id) ? (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-amber">Demo password</span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {locked ? (
                      <span className="tiny muted">Administrator only</span>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => open(member, "edit")}
                        >
                          Edit
                        </button>
                        {isSelf ? (
                          <a className="btn btn-ghost btn-sm" href="/staff/password">
                            My password
                          </a>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => open(member, "password")}
                            >
                              Reset password
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={rowSave.busy}
                              onClick={() =>
                                rowSave.save(
                                  "/api/ops/staff",
                                  { action: "toggle", id: member.id },
                                  member.active
                                    ? `${member.name} disabled and signed out`
                                    : `${member.name} enabled`,
                                )
                              }
                            >
                              {member.active ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => open(member, "delete")}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {openKind === "edit" ? (
                      <div style={{ display: "grid", gap: 8, marginTop: 10, maxWidth: 340 }}>
                        <input
                          className="input"
                          value={edit.name}
                          aria-label="Name"
                          onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                        />
                        <input
                          className="input"
                          type="email"
                          value={edit.email}
                          aria-label="Sign-in email"
                          onChange={(event) => setEdit({ ...edit, email: event.target.value })}
                        />
                        <select
                          className="select"
                          value={edit.role}
                          aria-label="Role"
                          disabled={isSelf}
                          onChange={(event) =>
                            setEdit({ ...edit, role: event.target.value as Role })
                          }
                        >
                          {(isSelf ? [member.role] : assignable).map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                        <span className="tiny muted">
                          {isSelf
                            ? "You cannot change your own role."
                            : `${ROLE_ACCESS[edit.role]}. A role change applies on their next click.`}
                        </span>
                        <div>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={rowSave.busy}
                            onClick={async () => {
                              const ok = await rowSave.save(
                                "/api/ops/staff",
                                { action: "update", id: member.id, ...edit },
                                `${edit.name} updated`,
                              );
                              if (ok) setPanel(null);
                            }}
                          >
                            Save changes
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {openKind === "password" ? (
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        <NewPasswordInput value={newPassword} onChange={setNewPassword} />
                        <span className="tiny muted">
                          Saving signs {member.name} out everywhere. Copy the
                          password before you save — it is not shown again.
                        </span>
                        <div>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={rowSave.busy}
                            onClick={async () => {
                              const ok = await rowSave.save(
                                "/api/ops/staff",
                                { action: "password", id: member.id, password: newPassword },
                                `Password reset for ${member.name}`,
                              );
                              if (ok) setPanel(null);
                            }}
                          >
                            Save new password
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {openKind === "delete" ? (
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        <span className="tiny">
                          Delete {member.name}’s account for good? Disable it
                          instead if they may come back.
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={rowSave.busy}
                            onClick={async () => {
                              const ok = await rowSave.save(
                                "/api/ops/staff",
                                { action: "delete", id: member.id },
                                `${member.name} deleted`,
                              );
                              if (ok) setPanel(null);
                            }}
                          >
                            Delete account
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setPanel(null)}
                          >
                            Keep
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Message message={rowSave.message} />
    </div>
  );
}

/* ------------------------------------------------------------------ customers */

export type CustomerAdminRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  guest: boolean;
  has_password: boolean;
  active: boolean;
  orders: number;
  created_at: string;
};

export function CustomerManager({ customers }: { customers: CustomerAdminRow[] }) {
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const { busy, message, save } = useSave();

  if (customers.length === 0)
    return (
      <div className="notice">
        No customer accounts yet. They appear here when someone signs up or
        checks out with an email address.
      </div>
    );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th>Login</th>
              <th>Orders</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <b>{customer.name}</b>
                  <div className="tiny muted">
                    {customer.phone || "No phone"} · since {formatDateTime(customer.created_at)}
                  </div>
                </td>
                <td className="tiny">{customer.email}</td>
                <td>
                  {!customer.active ? (
                    <span className="badge badge-muted">Disabled</span>
                  ) : customer.has_password ? (
                    <span className="badge badge-green">Has a password</span>
                  ) : (
                    <span className="badge badge-blue">Guest, no password</span>
                  )}
                </td>
                <td>{customer.orders}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setResetFor(resetFor === customer.id ? null : customer.id);
                        setNewPassword("");
                      }}
                    >
                      {customer.has_password ? "Reset password" : "Set password"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        save(
                          "/api/ops/customers",
                          { action: "toggle", id: customer.id },
                          customer.active
                            ? `${customer.name}’s login disabled`
                            : `${customer.name}’s login enabled`,
                        )
                      }
                    >
                      {customer.active ? "Disable login" : "Enable login"}
                    </button>
                  </div>
                  {resetFor === customer.id ? (
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      <NewPasswordInput value={newPassword} onChange={setNewPassword} />
                      <span className="tiny muted">
                        Copy the password before you save and give it to the
                        customer — it is not shown again.
                      </span>
                      <div>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={busy}
                          onClick={async () => {
                            const ok = await save(
                              "/api/ops/customers",
                              { action: "password", id: customer.id, password: newPassword },
                              `Password set for ${customer.name}`,
                            );
                            if (ok) setResetFor(null);
                          }}
                        >
                          Save new password
                        </button>
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Message message={message} />
    </div>
  );
}

/* -------------------------------------------------------------------- go live */

export function GoLivePanel({
  enabled,
  staffOnDemo,
  demoCustomers,
  selfOnDemo,
  isAdmin,
}: {
  enabled: boolean;
  /** Names of the other active accounts still on the demo password. */
  staffOnDemo: string[];
  demoCustomers: number;
  selfOnDemo: boolean;
  isAdmin: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { busy, message, save } = useSave();
  const nothingLeft = !enabled && !selfOnDemo && staffOnDemo.length === 0 && demoCustomers === 0;

  if (nothingLeft)
    return (
      <div className="notice notice-green">
        Demo credentials are retired. The sign-in page no longer lists demo
        logins and no active account uses the demo password. A disabled
        account marked “Demo password” needs a password reset before it can be
        enabled.
      </div>
    );

  return (
    <section className="panel" style={{ borderColor: "rgba(243, 171, 63, 0.35)" }}>
      <div className="panel-head">
        <h3>Demo credentials are still switched on</h3>
        <span className="badge badge-amber">Before you go live</span>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        The demo password is printed on the staff sign-in page and in the
        project README, so anyone can sign in with it. Removing the demo
        credentials does all of this in one step:
      </p>
      <ul className="small" style={{ margin: "8px 0 14px 18px", display: "grid", gap: 4 }}>
        <li>
          {selfOnDemo
            ? "Sets the new password below on your own account."
            : "Keeps your own account as it is."}
        </li>
        <li>
          {staffOnDemo.length > 0
            ? `Disables ${staffOnDemo.length} other account${staffOnDemo.length === 1 ? "" : "s"} still on the demo password (${staffOnDemo.join(", ")}). Reset each password, then enable the account again.`
            : "No other active account uses the demo password."}
        </li>
        <li>
          {demoCustomers > 0
            ? `Removes the ${demoCustomers} demo customer login${demoCustomers === 1 ? "" : "s"}. Their demo orders stay.`
            : "No demo customer logins to remove."}
        </li>
        <li>Stops the sign-in page listing and prefilling demo logins.</li>
      </ul>

      {!isAdmin ? (
        <div className="notice">Only an administrator can remove the demo credentials.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {selfOnDemo ? (
            <div className="field">
              <span className="label">New password for your account</span>
              <NewPasswordInput value={password} onChange={setPassword} width={260} />
              <span className="tiny muted">
                Save it somewhere safe first. You stay signed in on this device.
              </span>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {confirming ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await save(
                      "/api/ops/staff",
                      { action: "go_live", password: selfOnDemo ? password : undefined },
                      "Demo credentials removed",
                    );
                    if (ok) setPassword("");
                    setConfirming(false);
                  }}
                >
                  Yes, remove demo credentials
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirming(false)}
                >
                  Not yet
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setConfirming(true)}
              >
                Remove demo credentials
              </button>
            )}
            <Message message={message} />
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- my password */

export function ChangePasswordForm({ homePath }: { homePath: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (next !== repeat) {
      setError("The two new passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/staff/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not change your password");
      setDone(true);
      setCurrent("");
      setNext("");
      setRepeat("");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not change your password",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div className="notice notice-green">
          Password changed. Your other devices have been signed out.
        </div>
        <a className="btn btn-primary btn-block" href={homePath}>
          Back to work
        </a>
      </div>
    );

  return (
    <form onSubmit={submit}>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">Current password</span>
        <input
          className="input"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">New password</span>
        <input
          className="input"
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <span className="label">New password again</span>
        <input
          className="input"
          type="password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {error ? (
        <div className="notice notice-red" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
