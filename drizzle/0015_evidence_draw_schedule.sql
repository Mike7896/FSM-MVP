ALTER TABLE "evidence" ADD COLUMN "draw_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_draw_schedule_id_draw_schedule_id_fk" FOREIGN KEY ("draw_schedule_id") REFERENCES "public"."draw_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_draw_schedule_id_idx" ON "evidence" USING btree ("draw_schedule_id");