/** App release version and optional CI/git build id (VITE_APP_BUILD at image build). */
export function formatAppBuildLabel(): string {
  const version = import.meta.env.VITE_APP_VERSION?.trim() || 'dev';
  const build = import.meta.env.VITE_APP_BUILD?.trim();
  if (build) {
    const short = build.length > 7 ? build.slice(0, 7) : build;
    return `${version} (${short})`;
  }
  return version;
}
