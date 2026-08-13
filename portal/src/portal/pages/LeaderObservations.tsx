import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, MessageSquare, CheckCircle2, ChevronRight, AlertCircle } from "lucide-react";
import { leader } from "../services/api";
import PortalLayout from "../components/PortalLayout";
import LoadingState from "../components/LoadingState";
import ScoreIndicator from "../components/ScoreIndicator";
import type { LeaderObservationsData, LeaderObservationSession } from "../types/portal";

/**
 * Leader Portal — "Observations" (bd-2455).
 *
 * The coach's /observe world in one page: upcoming scheduled observations
 * (overdue-flagged — the same rows the WhatsApp "My schedule" screen lists),
 * debriefs still waiting, and the record of completed observations. Read-only:
 * scheduling and debriefing themselves happen in WhatsApp via /observe.
 */

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * bd-2670 — the line under the teacher's name. Riffat asked for the date, the
 * school and its EMIS code, because two teachers can share a name across
 * schools. Unknown parts are omitted rather than rendered as "null"/"—".
 */
function observationSubline(d: LeaderObservationSession): string {
  const bits = [`Observed ${formatDay(d.createdAt)}`];
  if (d.schoolName) bits.push(d.schoolName);
  if (d.emis) bits.push(`EMIS ${d.emis}`);
  return bits.join(" · ");
}

const LeaderObservations = () => {
  const [data, setData] = useState<LeaderObservationsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    leader
      .getObservations()
      .then((d) => { if (alive) setData(d.observations); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light">Observations</h1>
          <p className="text-muted-foreground mt-2">
            Your schedule, debriefs waiting, and completed observations. To schedule or debrief, send /observe to Rumi on WhatsApp.
          </p>
        </header>

        {loading ? (
          <LoadingState type="card" count={3} />
        ) : !data ? (
          <section className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <p className="text-muted-foreground">Your observations aren't available right now.</p>
          </section>
        ) : (
          <div className="space-y-8">
            {/* Upcoming schedule */}
            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3 flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-medium">Upcoming schedule</h2>
              </div>
              {data.upcoming.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">
                  Nothing scheduled yet — send /observe on WhatsApp and pick "Schedule new observation".
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.upcoming.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-6 py-4">
                      <div>
                        <p className="font-medium">{s.teacherName || "Unnamed teacher"}</p>
                        <p className="text-muted-foreground text-sm">{s.schoolName || "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">
                          {formatDay(s.scheduledFor)}
                          {s.scheduledSlot ? ` · ${s.scheduledSlot}` : ""}
                        </p>
                        {s.overdue && (
                          <p className="text-sm text-destructive flex items-center gap-1 justify-end">
                            <AlertCircle className="w-3.5 h-3.5" /> Overdue
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pending debriefs */}
            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-medium">Debriefs waiting</h2>
              </div>
              {data.pendingDebriefs.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">No debriefs waiting — all caught up.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.pendingDebriefs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between px-6 py-4">
                      <div>
                        <p className="font-medium">{d.teacherName || "Unassigned observation"}</p>
                        <p className="text-muted-foreground text-sm">{observationSubline(d)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {d.score != null && <ScoreIndicator percentage={d.score} size="small" />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Completed observations */}
            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-medium">Completed observations</h2>
              </div>
              {data.completed.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">No completed observations yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.completed.map((d) => {
                    const inner = (
                      <>
                        <div>
                          <p className="font-medium">{d.teacherName || "Unassigned observation"}</p>
                          <p className="text-muted-foreground text-sm">{observationSubline(d)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {d.score != null && <ScoreIndicator percentage={d.score} size="small" />}
                          {d.teacherUserId && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </>
                    );
                    return (
                      <li key={d.id}>
                        {d.teacherUserId ? (
                          <Link
                            to={`/portal/leader/teacher/${d.teacherUserId}`}
                            className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex items-center justify-between px-6 py-4">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderObservations;
