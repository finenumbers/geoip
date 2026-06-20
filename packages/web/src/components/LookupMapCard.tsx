import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicRuntime } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';

function formatCoord(value: number): string {
  return value.toLocaleString('ru', { maximumFractionDigits: 6 });
}

function resolveCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number } | null {
  if (latitude == null || longitude == null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

export function LookupMapCard({
  latitude,
  longitude,
  accuracyRadius,
  cityName,
}: {
  latitude?: number | null;
  longitude?: number | null;
  accuracyRadius?: number | null;
  cityName?: string | null;
}) {
  const { data: runtime } = useQuery({
    queryKey: ['public-runtime'],
    queryFn: fetchPublicRuntime,
    staleTime: 60_000,
  });
  const mapsApiKey = runtime?.googleMapsApiKey?.trim() || '';

  const coords = resolveCoords(latitude, longitude);

  const embedUrl = coords
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsApiKey)}&q=${coords.latitude},${coords.longitude}&zoom=12`
    : null;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-medium mb-3">Карта</h3>

      {!coords && <p className="text-muted text-sm">Координаты недоступны</p>}

      {coords && !mapsApiKey && (
        <p className="text-muted text-sm">
          Карта не настроена.{' '}
          <Link to="/admin" search={{ section: 'integrations' }} className="font-medium text-primary underline-offset-2 hover:underline">
            {ui.setup.mapsConfigureLink}
          </Link>
        </p>
      )}

      {coords && mapsApiKey && embedUrl && (
        <>
          <iframe
            title={cityName ? `Карта: ${cityName}` : 'Карта местоположения IP'}
            src={embedUrl}
            className="w-full h-80 rounded-lg border border-border"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
          <p className="mt-3 text-sm text-muted">
            {cityName ? `${cityName} · ` : ''}
            {formatCoord(coords.latitude)}, {formatCoord(coords.longitude)}
            {accuracyRadius != null ? ` · радиус ±${accuracyRadius.toLocaleString('ru')} км` : ''}
          </p>
        </>
      )}
    </div>
  );
}
