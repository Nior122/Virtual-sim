/**
 * In-app mirror of the server's neutral 404.
 *
 * Private mode blocks every route except the shared profile, so a client-side
 * navigation (the old "Home" button, a stale bookmark, the back cache) must
 * land on something with no links — never on the landing page or the grid.
 */
export default function PrivateNotFound() {
  return (
    <div className="min-h-screen bg-[#07080e] text-neutral-100 flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[44px] font-bold tracking-tight mb-2">404</h1>
      <p className="text-sm text-neutral-400 max-w-sm">
        This page is not available.
      </p>
    </div>
  );
}
