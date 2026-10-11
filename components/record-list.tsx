import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, FileText, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./record-list.module.css";

export function RecordList({ title, count, children }: {
  title: string; count: number; children: ReactNode;
}) {
  return (
    <section className={styles.list} aria-label={title}>
      <div className={styles.heading}>
        <h2>{title} <span className={styles.count}>{count}</span></h2>
        <span>Most recent first</span>
      </div>
      <ul className={styles.items}>{children}</ul>
    </section>
  );
}

export function RecordRow({ href, kind, title, reference, description, badges, tags, metrics }: {
  href: string;
  kind: "quote" | "job" | "customer";
  title: string;
  reference?: string;
  description: ReactNode;
  badges?: ReactNode;
  tags?: ReactNode;
  metrics: ReactNode;
}) {
  const Icon = { quote: FileText, job: BriefcaseBusiness, customer: UsersRound }[kind];
  return (
    <li>
      <Link href={href} className={styles.row}>
        <div className={styles.identity}>
          <span className={styles.icon} aria-hidden="true"><Icon size={21} strokeWidth={1.6} /></span>
          <div className={styles.copy}>
            <div className={styles.titleLine}>
              <span className={styles.title}>{title}</span>
              {reference && <span className={styles.reference}>{reference}</span>}
            </div>
            <p className={styles.description}>{description}</p>
            {badges && <div className={styles.badges}>{badges}</div>}
            {tags}
          </div>
        </div>
        <div className={styles.metrics}>{metrics}</div>
        <span className={styles.open} aria-hidden="true"><ArrowUpRight size={18} /></span>
      </Link>
    </li>
  );
}

export function RecordMetric({ label, children, positive = false }: {
  label: string; children: ReactNode; positive?: boolean;
}) {
  return <div className={styles.metric}><span className={styles.label}>{label}</span><div className={styles.value} data-positive={positive || undefined}>{children}</div></div>;
}
