import { useEffect, useState } from "react";
import { api, type EmailTemplate, type StakeRecipient, type StakeReportLayout } from "../../api.js";
import { buildEmail } from "../../publish/email.js";
import { StakeReportDoc } from "../../publish/stakeReport.js";
import { ErrorNote, KI_CODE, KI_IDS, KI_NAME, Loading, useAsync, useWeek } from "../../lib.js";
import { DEFAULT_STAKE_REPORT_LAYOUT, SECTION_LABELS } from "@shared/reportLayout";
import "../../publish/publish.css";

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
      <h3 style={{ margin: 0 }}>Stake-president reports</h3>
      <p className="muted" style={{ fontSize: ".85rem", maxWidth: "72ch" }}>
        What the report contains, the cover email that carries it, and who each stake's copy goes
        to. All of it is settings, not code: change it here and the Publish page follows.
      </p>
      {msg && <div className="note">{msg}</div>}

      <LayoutEditor onSaved={(m) => flash(m)} />

      <h4 style={{ marginTop: "2rem", fontWeight: 600 }}>Cover email</h4>
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

/**
 * The report's sections, order, and options, with a live preview on the
 * latest week's first stake. Saved to config `stake_report_layout`.
 */
function LayoutEditor({ onSaved }: { onSaved: (m: string) => void }) {
  const { week } = useWeek();
  const cfg = useAsync(() => api.config(), []);
  const pub = useAsync(() => (week ? api.publish(week) : Promise.resolve(null)), [week]);
  const [draft, setDraft] = useState<StakeReportLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewStake, setPreviewStake] = useState<string>("");

  useEffect(() => {
    if (cfg.data) setDraft(cfg.data.config.stakeReportLayout ?? DEFAULT_STAKE_REPORT_LAYOUT);
  }, [cfg.data]);

  if (cfg.loading || !draft) return <Loading what="the report layout" />;
  const saved = cfg.data?.config.stakeReportLayout ?? DEFAULT_STAKE_REPORT_LAYOUT;
  const L = draft;
  const set = (patch: Partial<StakeReportLayout>) => setDraft({ ...L, ...patch });
  const moveSection = (i: number, d: -1 | 1) => {
    const arr = [...L.sections];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    set({ sections: arr });
  };
  const reports = pub.data?.reports ?? [];
  const r = reports.find((x) => x.stake === previewStake) ?? reports[0];

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.setConfig("stake_report_layout", L);
      setEditing(false);
      onSaved("Report layout saved. Publish uses it from now on.");
      cfg.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>What the report contains</strong>
        <EditToggle
          editing={editing}
          busy={busy}
          onEdit={() => setEditing(true)}
          onCancel={() => (setDraft(saved), setEditing(false), setErr(null))}
          onSave={save}
        />
      </div>
      <p className="muted" style={{ fontSize: ".8rem", maxWidth: "76ch" }}>
        Tick the sections the president wants, put them in order, and choose which indicators the
        table and trend show. The preview below is the real latest-week report for one stake. A new
        <em> kind</em> of section (a chart, a different table) still needs a developer; the file to
        change is named at the top of <code>src/web/publish/stakeReport.tsx</code>.
      </p>
      {err && <div className="note stop">{err}</div>}

      {editing && (
        <div className="row" style={{ alignItems: "flex-start", gap: "2rem", flexWrap: "wrap", marginTop: ".6rem" }}>
          <div>
            <div className="muted mono" style={{ fontSize: ".72rem" }}>SECTIONS, IN ORDER</div>
            <table className="grid" style={{ maxWidth: 460 }}>
              <tbody>
                {L.sections.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ width: "2rem" }}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) =>
                          set({ sections: L.sections.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)) })
                        }
                      />
                    </td>
                    <td style={{ textAlign: "left" }}>{SECTION_LABELS[s.id]}</td>
                    <td style={{ width: "6rem" }}>
                      <button className="btn" onClick={() => moveSection(i, -1)} disabled={i === 0}>↑</button>{" "}
                      <button className="btn" onClick={() => moveSection(i, 1)} disabled={i === L.sections.length - 1}>↓</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="muted mono" style={{ fontSize: ".72rem", marginTop: "1rem" }}>INDICATORS SHOWN</div>
            <div className="row" style={{ gap: ".4rem 1rem" }}>
              {KI_IDS.map((ki) => (
                <label key={ki} className="row" style={{ gap: ".3rem" }} title={KI_NAME[ki]}>
                  <input
                    type="checkbox"
                    checked={L.kis.includes(ki)}
                    onChange={(e) =>
                      set({ kis: e.target.checked ? [...KI_IDS].filter((k) => k === ki || L.kis.includes(k)) : L.kis.filter((k) => k !== ki) })
                    }
                  />
                  <span className="mono" style={{ fontSize: ".8rem" }}>{KI_CODE[ki]}</span>
                </label>
              ))}
            </div>

            <div className="row" style={{ marginTop: "1rem", gap: "1rem" }}>
              <label className="field" style={{ margin: 0 }}>
                <span className="k mono">Trend weeks</span>
                <input type="number" min={4} max={26} value={L.trendWeeks} onChange={(e) => set({ trendWeeks: parseInt(e.target.value, 10) || 12 })} style={{ width: 80 }} />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span className="k mono">Baptized, months back</span>
                <input type="number" min={1} max={24} value={L.baptizedMonths} onChange={(e) => set({ baptizedMonths: parseInt(e.target.value, 10) || 6 })} style={{ width: 80 }} />
              </label>
            </div>

            <div className="muted mono" style={{ fontSize: ".72rem", marginTop: "1rem" }}>HEADLINE TILES</div>
            <div className="row" style={{ gap: ".4rem 1rem" }}>
              {(["baptizedThisMonth", "baptizedThisYear", "onDate"] as const).map((k) => (
                <label key={k} className="row" style={{ gap: ".3rem" }}>
                  <input type="checkbox" checked={L.stats[k]} onChange={(e) => set({ stats: { ...L.stats, [k]: e.target.checked } })} />
                  <span style={{ fontSize: ".85rem" }}>
                    {k === "baptizedThisMonth" ? "Baptized this month" : k === "baptizedThisYear" ? "Baptized this year" : "On a baptismal date"}
                  </span>
                </label>
              ))}
            </div>

            <div className="muted mono" style={{ fontSize: ".72rem", marginTop: "1rem" }}>ON-DATE LIST COLUMNS</div>
            <div className="row" style={{ gap: ".4rem 1rem" }}>
              {(["ward", "church2x", "calendar"] as const).map((k) => (
                <label key={k} className="row" style={{ gap: ".3rem" }}>
                  <input type="checkbox" checked={L.onDate[k]} onChange={(e) => set({ onDate: { ...L.onDate, [k]: e.target.checked } })} />
                  <span style={{ fontSize: ".85rem" }}>{k === "ward" ? "Ward" : k === "church2x" ? "Church 2×" : "Calendar"}</span>
                </label>
              ))}
              <label className="row" style={{ gap: ".3rem" }}>
                <input type="checkbox" checked={L.showUnverified} onChange={(e) => set({ showUnverified: e.target.checked })} />
                <span style={{ fontSize: ".85rem" }}>Flag unverified legacy names</span>
              </label>
            </div>

            <div className="field" style={{ marginTop: "1rem", maxWidth: 460 }}>
              <label>Subtitle line ({"{week}"} = the week label)</label>
              <input value={L.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
            </div>
            <div className="field" style={{ maxWidth: 460 }}>
              <label>Introductory paragraph (shown when that section is ticked)</label>
              <textarea className="paste" style={{ minHeight: 70 }} value={L.introText} onChange={(e) => set({ introText: e.target.value })} />
            </div>
            <div className="field" style={{ maxWidth: 460 }}>
              <label>Closing note (shown when that section is ticked)</label>
              <textarea className="paste" style={{ minHeight: 70 }} value={L.noteText} onChange={(e) => set({ noteText: e.target.value })} />
            </div>
            <button className="btn" onClick={() => setDraft(DEFAULT_STAKE_REPORT_LAYOUT)}>Reset to default</button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginTop: "1rem" }}>
        <span className="muted mono" style={{ fontSize: ".72rem" }}>
          PREVIEW{editing ? " (unsaved draft)" : ""}{pub.data ? ` · ${pub.data.weekLabel}` : ""}
        </span>
        {reports.length > 1 && (
          <select value={r?.stake ?? ""} onChange={(e) => setPreviewStake(e.target.value)} style={{ fontSize: ".8rem" }}>
            {reports.map((x) => <option key={x.stake} value={x.stake}>{x.stake}</option>)}
          </select>
        )}
      </div>
      {pub.loading && <Loading what="a preview" />}
      {pub.err && <ErrorNote err={pub.err} />}
      {r && pub.data && (
        <div className="publish-preview" style={{ overflow: "auto", maxHeight: 640 }}>
          <StakeReportDoc r={r} weekLabel={pub.data.weekLabel} generatedAt={pub.data.generatedAt} layout={L} />
        </div>
      )}
      {!pub.loading && !r && <p className="muted">Import a week to see a preview.</p>}
    </div>
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
