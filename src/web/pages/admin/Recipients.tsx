import { useEffect, useState } from "react";
import { api, type EmailTemplate, type StakeRecipient } from "../../api.js";
import { buildEmail } from "../../publish/email.js";
import { ErrorNote, Loading, useAsync } from "../../lib.js";

export function RecipientsPage() {
  const { data, err, loading, reload } = useAsync(() => api.recipients(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };

  if (loading) return <Loading what="recipients" />;
  if (err || !data) return <ErrorNote err={err ?? "no data"} />;

  return (
    <>
      <h3 style={{ margin: 0 }}>Stake-report email</h3>
      <p className="muted" style={{ fontSize: ".85rem", maxWidth: "72ch" }}>
        Everything the Publish page's "Open in Gmail" link uses. Comma-separate multiple addresses.
      </p>
      {msg && <div className="note">{msg}</div>}

      <CcEditor initial={data.ccAll} onSaved={(m) => (flash(m), reload())} />

      <TemplateEditor
        template={data.emailTemplate}
        fallback={data.defaultEmailTemplate}
        onSaved={(m) => (flash(m), reload())}
      />

      <h4 style={{ marginTop: "2rem", fontWeight: 600 }}>Per stake</h4>
      {data.recipients.length === 0 && (
        <div className="note">
          Nothing here yet.{" "}
          <SeedButton onDone={(m) => (flash(m), reload())} />
        </div>
      )}
      {data.recipients.map((r) => (
        <StakeRow key={r.stake} row={r} onSaved={(m) => (flash(m), reload())} />
      ))}
    </>
  );
}

function EditToggle({
  editing,
  onEdit,
  onCancel,
  onSave,
  busy,
}: {
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  if (!editing)
    return (
      <button className="btn" onClick={onEdit}>
        Edit
      </button>
    );
  return (
    <span className="row" style={{ gap: ".4rem" }}>
      <button className="btn primary" disabled={busy} onClick={onSave}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button className="btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

function CcEditor({ initial, onSaved }: { initial: string[]; onSaved: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial.join(", "));
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(initial.join(", ")), [initial]);

  return (
    <div className="drawer">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>CC on every stake report</strong>
        <EditToggle
          editing={editing}
          busy={busy}
          onEdit={() => setEditing(true)}
          onCancel={() => (setVal(initial.join(", ")), setEditing(false))}
          onSave={async () => {
            setBusy(true);
            try {
              const list = val.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
              await api.setReportCc(list);
              setEditing(false);
              onSaved("CC list saved");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {editing ? (
        <div className="field" style={{ marginTop: ".5rem" }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="president@…, secretary@…" />
        </div>
      ) : (
        <div className="recipient-chips" style={{ marginTop: ".4rem" }}>
          {initial.length === 0 && <span className="muted">none set</span>}
          {initial.map((e) => (
            <span key={e} className="chip">{e}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  fallback,
  onSaved,
}: {
  template: EmailTemplate;
  fallback: EmailTemplate;
  onSaved: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSubject(template.subject);
    setBody(template.body);
  }, [template]);

  const preview = buildEmail({
    stake: "Annandale",
    presidentName: "Smith",
    weekStartIso: new Date().toISOString().slice(0, 10),
    weekLabel: "Week of 8/24",
    template: { subject, body },
  });

  return (
    <div className="drawer">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Cover-letter template</strong>
        <EditToggle
          editing={editing}
          busy={busy}
          onEdit={() => setEditing(true)}
          onCancel={() => (setSubject(template.subject), setBody(template.body), setEditing(false))}
          onSave={async () => {
            setBusy(true);
            try {
              await api.setReportTemplate({ subject, body });
              setEditing(false);
              onSaved("Template saved");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <p className="muted" style={{ fontSize: ".8rem" }}>
        Placeholders: <code>{"{stake}"}</code> <code>{"{president}"}</code> <code>{"{date}"}</code>{" "}
        <code>{"{weekLabel}"}</code>
      </p>

      {editing ? (
        <>
          <div className="field">
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea
              className="paste"
              style={{ minHeight: 240 }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <button className="btn" onClick={() => (setSubject(fallback.subject), setBody(fallback.body))}>
            Reset to default
          </button>
        </>
      ) : (
        <div style={{ marginTop: ".5rem" }}>
          <div className="muted mono" style={{ fontSize: ".78rem" }}>SUBJECT</div>
          <div style={{ fontSize: ".9rem", marginBottom: ".6rem" }}>{preview.subject}</div>
          <div className="muted mono" style={{ fontSize: ".78rem" }}>BODY (Annandale example)</div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: ".85rem",
              background: "var(--surface-sunk)",
              padding: ".7rem .9rem",
              borderRadius: 6,
              margin: ".3rem 0 0",
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {preview.bodyText}
          </pre>
        </div>
      )}
    </div>
  );
}

function StakeRow({ row, onSaved }: { row: StakeRecipient; onSaved: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [pres, setPres] = useState(row.presidentName ?? "");
  const [to, setTo] = useState(row.toEmails ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPres(row.presidentName ?? "");
    setTo(row.toEmails ?? "");
  }, [row]);

  return (
    <div className="drawer">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{row.stake}</strong>
        <EditToggle
          editing={editing}
          busy={busy}
          onEdit={() => setEditing(true)}
          onCancel={() => (setPres(row.presidentName ?? ""), setTo(row.toEmails ?? ""), setEditing(false))}
          onSave={async () => {
            setBusy(true);
            try {
              await api.setRecipient({ stake: row.stake, presidentName: pres || null, toEmails: to || null });
              setEditing(false);
              onSaved(`Saved ${row.stake}`);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {editing ? (
        <>
          <div className="field">
            <label>Stake president (letter greeting)</label>
            <input value={pres} onChange={(e) => setPres(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: ".88rem", marginTop: ".3rem" }}>
          <div className="muted">
            President: {row.presidentName || <span style={{ color: "var(--band-mid)" }}>not set</span>}
          </div>
          <div className="recipient-chips" style={{ marginTop: ".3rem" }}>
            {(row.toEmails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@")).map((e) => (
              <span key={e} className="chip to">{e}</span>
            ))}
            {!(row.toEmails ?? "").includes("@") && <span className="muted">no To addresses</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function SeedButton({ onDone }: { onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.seedRecipients();
          onDone(`Seeded ${r.seeded} stakes`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Seeding…" : "Seed from the old EMAILS sheet"}
    </button>
  );
}
