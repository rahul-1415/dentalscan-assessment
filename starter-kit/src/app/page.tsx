import ScanningFlow from "@/components/ScanningFlow";

export default function Home() {
  return (
    <main className="flex h-[100svh] items-stretch justify-center bg-zinc-100">
      {/* Side panels on desktop, hidden on mobile */}
      <div className="hidden flex-1 bg-zinc-100 sm:block" />

      {/* App content — full screen on mobile, 670px wide on desktop */}
      <div className="h-full w-full overflow-hidden shadow-xl sm:w-[670px] sm:shrink-0">
        <ScanningFlow />
      </div>

      <div className="hidden flex-1 bg-zinc-100 sm:block" />
    </main>
  );
}
