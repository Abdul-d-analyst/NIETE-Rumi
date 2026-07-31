import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Users } from "lucide-react";
import { leader } from "../services/api";
import PortalLayout from "../components/PortalLayout";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import ScoreIndicator from "../components/ScoreIndicator";
import type { LeaderPatchTeacher } from "../types/portal";

/**
 * Leader Portal — Teachers roster (bd-2434, NIETE port of upstream bd-2392).
 * The leader's whole patch from GET /leader/teachers: each teacher with their
 * Rumi activity (sessions, lesson plans, last score). Teachers not yet on Rumi
 * are shown with a muted badge so the leader sees their full patch. On-Rumi
 * teachers link to their detail.
 */
const LeaderTeachers = () => {
  const [teachers, setTeachers] = useState<LeaderPatchTeacher[]>([]);
  const [summary, setSummary] = useState<{ total: number; onRumi: number }>({ total: 0, onRumi: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    leader
      .getTeachers()
      .then((d) => { if (alive) { setTeachers(d.teachers); setSummary({ total: d.total, onRumi: d.onRumi }); } })
      .catch(() => { if (alive) setTeachers([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-light">Teachers</h1>
          {!loading && (
            <p className="text-muted-foreground mt-2">
              {summary.total} teacher{summary.total === 1 ? "" : "s"} in your patch · {summary.onRumi}/{summary.total} on Rumi
            </p>
          )}
        </header>

        {loading ? (
          <LoadingState type="list" count={6} />
        ) : teachers.length === 0 ? (
          <EmptyState icon={Users} title="No teachers yet" description="Teachers in your patch will appear here once your roster is set up." />
        ) : (
          <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              {teachers.map((t) => {
                const row = (
                  <div className="flex items-center justify-between px-6 py-4">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t.name || "Unnamed teacher"}</p>
                      <p className="text-muted-foreground text-sm">
                        {t.onRumi
                          ? `${t.coachingSessions} session${t.coachingSessions === 1 ? "" : "s"} · ${t.lessonPlans} lesson plan${t.lessonPlans === 1 ? "" : "s"}`
                          : "Not yet on Rumi"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {t.lastScore != null && <ScoreIndicator percentage={t.lastScore} size="small" />}
                      {!t.onRumi && (
                        <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">Invite</span>
                      )}
                      {t.onRumi && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                );
                return (
                  <li key={t.rumiUserId || t.phone || t.teacherExtId}>
                    {t.onRumi && t.rumiUserId ? (
                      <Link to={`/portal/leader/teacher/${t.rumiUserId}`} className="block hover:bg-muted/40 transition-colors">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderTeachers;
