import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./auth";
import { tourStatusEnum } from "./enums";

/**
 * Where each person is in each product tour.
 *
 * **Per person, not per shop.** A tour teaches someone how the app works, and a
 * technician who joins next year has not seen it because the owner has.
 * **In the database, not the browser**, so a tour skipped on a phone is skipped
 * on the laptop, and "Resume tour" has something to resume.
 *
 * `tour_id` is text rather than an enum: tours are defined in code
 * (`lib/tours/registry.ts`) and the API refuses ids the registry doesn't know,
 * so adding a tour never needs a migration.
 */
export const tourProgress = pgTable(
  "tour_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tourId: text("tour_id").notNull(),
    status: tourStatusEnum("status").notNull(),
    /** The step to resume at. */
    stepId: text("step_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tour_progress_user_tour_key").on(t.userId, t.tourId)]
);
