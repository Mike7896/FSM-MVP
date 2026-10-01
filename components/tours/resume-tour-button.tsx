"use client";

import { useRouter } from "next/navigation";

import { useTours } from "@/components/tours/context";
import { Button } from "@/components/ui/button";
import { TOURS, type TourId } from "@/lib/tours";

/** Picks a tour up where this person stopped, on the screen it runs on. */
export function ResumeTourButton({ tourId }: { tourId: TourId }) {
  const router = useRouter();
  const { resume } = useTours();

  return (
    <Button
      size="sm"
      className="shrink-0"
      onClick={() => {
        resume(tourId);
        router.push(TOURS[tourId].href);
      }}
    >
      Resume tour
    </Button>
  );
}
