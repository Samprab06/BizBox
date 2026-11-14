export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-5 px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-slate-600">
        HackPrinceton
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
        Service-business location planning
      </h1>
      <p className="max-w-xl text-lg leading-8 text-slate-700">
        The workspace foundation is ready for the intake, site comparison, and
        grounded location plan screens.
      </p>
      <a
        className="w-fit rounded border border-slate-400 px-4 py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
        href="/api/health"
      >
        Check service health
      </a>
    </main>
  );
}
