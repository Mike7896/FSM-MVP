-- Tasks: the things somebody has to do, on a job or for the shop.
--
-- A task can be tagged like a job, a quote or a customer, and a visit on the
-- schedule can say which task it was booked to get done.

CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('none', 'urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"assignee_id" uuid,
	"due_on" date,
	"position" double precision DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_check" CHECK (length(btrim("tasks"."title")) between 1 and 200)
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_number_unique" ON "tasks" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "tasks_org_status_position_idx" ON "tasks" USING btree ("organization_id","status","position");--> statement-breakpoint
CREATE INDEX "tasks_job_idx" ON "tasks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_org_due_on_idx" ON "tasks" USING btree ("organization_id","due_on");--> statement-breakpoint

-- Numbered per shop, the way jobs are: an advisory lock per organization so two
-- tasks made at the same moment can't both take the same number.
create or replace function public.set_task_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is null or new.number = 0 then
    perform pg_advisory_xact_lock(hashtextextended('task:' || new.organization_id::text, 0));
    select coalesce(max(number), 0) + 1 into new.number
      from public.tasks where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;--> statement-breakpoint
create trigger set_task_number before insert on public.tasks
  for each row execute function public.set_task_number();--> statement-breakpoint

-- A task's job must be the same shop's job, even for writes outside the API.
create or replace function public.task_job_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from jobs where id = new.job_id and organization_id = new.organization_id
  ) then
    raise exception 'A task''s job must belong to the same organization.' using errcode = '23514';
  end if;
  return new;
end;
$$;--> statement-breakpoint
create trigger task_job_guard before insert or update on public.tasks
  for each row execute function public.task_job_guard();--> statement-breakpoint

alter table public.tasks enable row level security;--> statement-breakpoint
create policy "tasks: members read"
  on public.tasks for select to authenticated
  using (public.is_org_member(organization_id));--> statement-breakpoint

-- The visit a task was booked for.
ALTER TABLE "visits" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_task_idx" ON "visits" USING btree ("task_id");--> statement-breakpoint

-- Tags on tasks: a fourth kind of target.
ALTER TABLE "tag_assignments" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_assignments" DROP CONSTRAINT "tag_assignment_one_target";--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignment_one_target" CHECK (num_nonnulls(job_id, quote_id, customer_id, task_id) = 1);--> statement-breakpoint
CREATE UNIQUE INDEX "tag_task_unique" ON "tag_assignments" USING btree ("task_id","tag_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tag_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND organization_id = NEW.organization_id)
 OR (NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND organization_id = NEW.organization_id))
 OR (NEW.quote_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.quote_id AND organization_id = NEW.organization_id AND type = 'quote'))
 OR (NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND organization_id = NEW.organization_id))
 OR (NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND organization_id = NEW.organization_id)) THEN
 RAISE EXCEPTION 'Tag and target must belong to the same organization and target must be a supported object.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
