const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? '';

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
          Карта не настроена: задайте <code className="text-foreground">VITE_GOOGLE_MAPS_API_KEY</code> и
          пересоберите web.
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
