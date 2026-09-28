import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tourProgress } from "@/lib/db/schema";
import { findTour, type TourProgress, type TourStatus } from "@/lib/tours";

/**
 * Tour progress, read and written for one person.
 *
 * Every function takes a `userId` the caller has already verified — a session
 * in a layout, `requireCaller` in a route.
 */

export async function listTourProgress(
  userId: string
): Promise<TourProgress[]> {
  const rows = await db
    .select()
    .from(tourProgress)
    .where(eq(tourProgress.userId, userId));

  return rows.flatMap((row) => {
    // A row for a tour since removed from the registry is history, not
    // something to resume.
    const tour = findTour(row.tourId);
    return tour
      ? [
          {
            tourId: tour.id,
            status: row.status,
            stepId: row.stepId,
            updatedAt: row.updatedAt.toISOString(),
          },
        ]
      : [];
  });
}

export async function saveTourProgress(
  userId: string,
  tourId: TourProgress["tourId"],
  status: TourStatus,
  stepId: string | null
): Promise<TourProgress> {
  const [row] = await db
    .insert(tourProgress)
    .values({ userId, tourId, status, stepId })
    .onConflictDoUpdate({
      target: [tourProgress.userId, tourProgress.tourId],
      set: { status, stepId, updatedAt: new Date() },
    })
    .returning();

  return {
    tourId,
    status: row.status,
    stepId: row.stepId,
    updatedAt: row.updatedAt.toISOString(),
  };
}
