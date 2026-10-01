-- Preserve already-published jobs when introducing Free activation limits.
-- Keep the original month so current-month usage is counted and old jobs
-- remain completable. No foreign key to jobs: deleting a job must not refund usage.
INSERT INTO job_activations (job_id, organization_id, period, status, action, token, reserved_at, committed_at)
SELECT d.job_id, d.organization_id,
       to_char(min(d.sent_at) AT TIME ZONE 'UTC', 'YYYY-MM'),
       'committed', 'legacy_publication', gen_random_uuid(), min(d.sent_at), min(d.sent_at)
FROM documents d
JOIN jobs j ON j.id = d.job_id
WHERE d.sent_at IS NOT NULL AND j.is_demo = false
GROUP BY d.job_id, d.organization_id
ON CONFLICT (job_id) DO NOTHING;
