export type BuildKind = "new" | "better" | "fixed";

export type BuildItem = {
  kind: BuildKind;
  text: string;
};

export type BuildEntry = {
  /** `YYYY-MM-DD`, the day it landed. */
  date: string;
  title: string;
  items: BuildItem[];
};

export const KIND_LABEL: Record<BuildKind, string> = {
  new: "New",
  better: "Better",
  fixed: "Fixed",
};

export const RELEASE_NOTES_ROUTE = "/release-notes";
export const RELEASE_NOTES_TITLE = "Release Notes";
