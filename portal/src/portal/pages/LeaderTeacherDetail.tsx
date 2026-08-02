import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, MessageSquare, BookOpen, FileText, Users } from "lucide-react";
import { leader } from "../services/api";
import PortalLayout from "../components/PortalLayout";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import ScoreIndicator from "../components/ScoreIndicator";
import type { LeaderTeacherDetail as Detail } from "../types/portal";

/**
 * Leader Portal — single teacher detail (bd-2434, NIETE port of upstream
 * bd-2393). GET /leader/teacher/:id, which is patch-membership guarded
 * server-side (a leader can only open a teacher in their own patch; anything
 * else 404s → the not-found state below).
 */
const LeaderTeacherDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    leader
      .getTeacher(id)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-4xl px-6 py-8">
        <Link to="/portal/leader/teachers" className="text-accent text-sm font-medium flex items-center gap-1 mb-6">
          <ChevronLeft className="w-4 h-4" /> All teachers
        </Link>

        {loading ? (
          <LoadingState type="card" count={3} />
        ) : notFound || !detail ? (
          <EmptyState icon={Users} title="Teacher not found" description="This teacher isn't in your patch, or their record is unavailable." />
        ) : (
          <>
            <header className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-light">{detail.teacher.name || "Unnamed teacher"}</h1>
                <p className="text-muted-foreground mt-1">{detail.teacher.phone}</p>
              </div>
              {detail.stats.lastScore != null && <ScoreIndicator percentage={detail.stats.lastScore} size="large" />}
            </header>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <StatCard title="Coaching sessions" value={detail.stats.coachingSessions} icon={MessageSquare} />
              <StatCard title="Lesson plans" value={detail.stats.lessonPlans} icon={BookOpen} />
              <StatCard title="Reading assessments" value={detail.stats.readingAssessments} icon={FileText} />
            </div>

            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3">
                <h2 className="text-lg font-medium">Coaching history</h2>
              </div>
              {detail.sessions.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">No completed coaching sessions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.sessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-6 py-4">
                      <div>
                        <p className="font-medium">{fmtDate(s.date)}</p>
                        {s.points != null && s.maxPoints != null && (
                          <p className="text-muted-foreground text-sm">{s.points} / {s.maxPoints} marks</p>
                        )}
                      </div>
                      {s.score != null && <ScoreIndicator percentage={s.score} size="small" />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderTeacherDetail;
