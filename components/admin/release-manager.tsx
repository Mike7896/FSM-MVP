"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KIND_LABEL, type BuildItem } from "@/lib/release-notes/entries";

type Release = { id: string; version: string; title: string; items: BuildItem[]; publishedAt: string | null };
export function ReleaseManager({ releases }: { releases: Release[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<BuildItem[]>([{ kind: "new", text: "" }]);
  const [busy, setBusy] = useState(false);

  async function mutate(url: string, method: string, body: unknown) {
    setBusy(true);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Couldn't save this release.");
      router.refresh();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't reach the server."); return false; }
    finally { setBusy(false); }
  }
  function reset() { setEditing(null); setVersion(""); setTitle(""); setItems([{ kind: "new", text: "" }]); }

  return <main className="mx-auto w-full max-w-4xl space-y-8 p-4 md:p-8">
    <header><h1 className="text-2xl font-semibold">Product releases</h1><p className="text-muted-foreground mt-2">Write the changes, review your draft, then publish after the version is deployed.</p></header>
    <form className="bg-card space-y-4 rounded-xl border p-5" onSubmit={async event => {
      event.preventDefault();
      if (await mutate(editing ? `/api/v1/admin/releases/${editing}` : "/api/v1/admin/releases", editing ? "PATCH" : "POST", { version, title, items, ...(editing ? { action: "save" } : {}) })) { reset(); toast.success("Draft saved."); }
    }}>
      <h2 className="font-semibold">{editing ? "Edit draft" : "New release"}</h2>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]"><label className="space-y-2 text-sm">Version<Input required disabled={!!editing || busy} value={version} placeholder="0.1.0" pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" onChange={e => setVersion(e.target.value)} /></label><label className="space-y-2 text-sm">Title<Input required maxLength={140} disabled={busy} value={title} onChange={e => setTitle(e.target.value)} /></label></div>
      {items.map((item, index) => <div key={index} className="flex flex-wrap items-start gap-2">
        <select aria-label={`Change ${index + 1} category`} disabled={busy} className="bg-background rounded-md border p-2 text-sm" value={item.kind} onChange={e => setItems(items.map((entry, i) => i === index ? { ...entry, kind: e.target.value as BuildItem["kind"] } : entry))}>{Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <Textarea aria-label={`Change ${index + 1}`} required maxLength={2000} disabled={busy} className="min-w-48 flex-1" placeholder="Describe what customers can now do." value={item.text} onChange={e => setItems(items.map((entry, i) => i === index ? { ...entry, text: e.target.value } : entry))} />
        <Button type="button" variant="ghost" disabled={busy || items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || items.length >= 50} onClick={() => setItems([...items, { kind: "better", text: "" }])}>Add change</Button><Button disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>{editing && <Button type="button" variant="ghost" disabled={busy} onClick={reset}>Cancel editing</Button>}</div>
    </form>
    <div className="space-y-4">{releases.length === 0 && <p className="text-muted-foreground">No releases yet. Create a draft above.</p>}{releases.map(release => <article key={release.id} className="bg-card space-y-3 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">v{release.version} · {release.title}</h2><span className="text-muted-foreground text-xs">{release.publishedAt ? `Published ${new Date(release.publishedAt).toLocaleDateString()}` : "Draft · visible to admins only"}</span></div>
      <ul className="space-y-2 text-sm">{release.items.map((item, i) => <li key={i}><span className="mr-2 font-medium">{KIND_LABEL[item.kind]}</span>{item.text}</li>)}</ul>
      {!release.publishedAt ? <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => { setEditing(release.id); setVersion(release.version); setTitle(release.title); setItems(release.items); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit draft</Button><Button disabled={busy || editing === release.id} onClick={async () => { if (await mutate(`/api/v1/admin/releases/${release.id}`, "PATCH", { action: "publish" })) toast.success(`v${release.version} published.`); }}>Publish v{release.version}</Button></div> : <a className="text-sm underline" href={`/release-notes#v${release.version}`}>View published release</a>}
    </article>)}</div>
  </main>;
}
