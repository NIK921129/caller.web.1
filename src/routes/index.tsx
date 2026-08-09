import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Call Assistant — Setup Overview" },
      {
        name: "description",
        content:
          "AI call-forwarding assistant: Twilio + Gemini answer your calls, store transcripts in MongoDB and analyse every conversation.",
      },
      { property: "og:title", content: "AI Call Assistant — Setup Overview" },
      {
        property: "og:description",
        content:
          "Static frontend for Vercel, four-file Express backend for Render, MongoDB for transcripts and settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const files = [
  { path: "frontend/index.html", note: "Dashboard, login, all screens" },
  { path: "frontend/styles.css", note: "Design system" },
  { path: "frontend/app.js", note: "All frontend logic" },
  { path: "frontend/config.js", note: "API_BASE_URL of your Render service" },
  { path: "backend/server.js", note: "API: auth, settings, calls, analytics" },
  { path: "backend/db.js", note: "MongoDB models" },
  { path: "backend/ai.js", note: "Gemini replies + call analysis" },
  { path: "backend/voice.js", note: "Twilio conversation loop, forwarding, SMS" },
];

const steps = [
  "MongoDB Atlas — create a cluster, copy the connection string.",
  "Render — deploy the backend/ folder, add every var from backend/.env.example, then set PUBLIC_URL.",
  "Vercel — deploy the frontend/ folder (no build step), set API_BASE_URL in frontend/config.js.",
  "Twilio — point your number's voice webhook (POST) at /api/voice/incoming and the status callback at /api/voice/status.",
  "Sign in to the dashboard, open Credentials, paste your keys and press Test connections.",
];

function Index() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Custom deployment · Vercel + Render + MongoDB
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">AI Call Assistant</h1>
        <p className="mt-4 text-muted-foreground">
          Twilio answers your forwarded number, Gemini talks to the caller, and every transcript plus
          AI analysis lands in MongoDB. Credentials, prompts and routing are all editable from the
          dashboard.
        </p>

        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Project files
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {files.map((f) => (
              <li key={f.path} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                <code className="font-mono">{f.path}</code>
                <span className="text-muted-foreground">{f.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Deployment steps
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm leading-relaxed">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <p className="mt-12 text-sm text-muted-foreground">
          Environment templates: <code className="font-mono">backend/.env.example</code> for Render and{" "}
          <code className="font-mono">frontend/.env.example</code> for Vercel. Full details are in{" "}
          <code className="font-mono">README.md</code>.
        </p>
      </div>
    </main>
  );
}
