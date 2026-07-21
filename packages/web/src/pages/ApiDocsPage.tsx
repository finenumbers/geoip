import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HelpBox } from '@/components/HelpBox';
import { adminApi } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

function useBaseUrl(): string {
  return useMemo(() => {
    if (typeof window === 'undefined') return 'https://geoip.example.com';
    return window.location.origin;
  }, []);
}

function CodeBlock({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn('relative', className)}>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-accent"
      >
        {copied ? ui.apiDocs.copied : ui.apiDocs.copy}
      </button>
    </div>
  );
}

function DocSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3 rounded-lg border border-border bg-card p-4', className)}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EndpointBadge({ method, path }: { method: string; path: string }) {
  return (
    <p className="text-sm">
      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
        {method}
      </span>{' '}
      <code className="break-all text-sm">{path}</code>
    </p>
  );
}

export function ApiDocsPage() {
  const navigate = useNavigate();
  const baseUrl = useBaseUrl();

  const { data: me, isError: meError, isLoading: meLoading } = useQuery({
    queryKey: ['admin-me'],
    queryFn: adminApi.me,
    retry: false,
  });

  const { data: keyData, isLoading: keyLoading } = useQuery({
    queryKey: ['admin-external-api-key'],
    queryFn: adminApi.getExternalApiKey,
    enabled: Boolean(me),
  });

  useEffect(() => {
    if (meError) {
      void navigate({ to: '/admin/login', search: { redirect: '/api-docs' } });
    }
  }, [meError, navigate]);

  const apiKey = keyData?.apiKey?.trim() ?? '';
  const keyForExamples = apiKey || '<API_KEY>';

  const lookupUrl = `${baseUrl}/api/v1/lookup`;
  const rirLookupUrl = `${baseUrl}/api/v1/rir/lookup`;
  const enrichUrl = `${baseUrl}/api/v1/rir/enrich`;

  const lookupCurl = `curl -sS -X POST '${lookupUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${keyForExamples}' \\
  -d '{"ip":"8.8.8.8","include":["city","country","asn"]}'`;

  const lookupFetch = `const response = await fetch('${lookupUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${keyForExamples}',
  },
  body: JSON.stringify({
    ip: '8.8.8.8',
    include: ['city', 'country', 'asn'],
  }),
});
const data = await response.json();`;

  const lookupPython = `import requests

response = requests.post(
    '${lookupUrl}',
    headers={
        'Content-Type': 'application/json',
        'X-API-Key': '${keyForExamples}',
    },
    json={'ip': '8.8.8.8', 'include': ['city', 'country', 'asn']},
    timeout=30,
)
print(response.json())`;

  const rirCurl = `curl -sS -X POST '${rirLookupUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${keyForExamples}' \\
  -d '{"ip":"8.8.8.8"}'`;

  const rirFetch = `const response = await fetch('${rirLookupUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${keyForExamples}',
  },
  body: JSON.stringify({ ip: '8.8.8.8' }),
});
const data = await response.json();`;

  const enrichCurl = `curl -sS -X POST '${enrichUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${keyForExamples}' \\
  -d '{"registry":"apnic","resourceType":"ipv4","rangeText":"1.1.1.0/24","network":"1.1.1.0/24"}'`;

  const lookupResponse = `{
  "ip": "8.8.8.8",
  "city": { "network": "…", "countryIsoCode": "US", "cityName": "…", "latitude": 37.4, "longitude": -122.1 },
  "country": { "network": "…", "countryIsoCode": "US", "countryName": "…" },
  "asn": { "network": "…", "asn": 15169, "organization": "GOOGLE" },
  "meta": { "datasetDate": "20260701", "queriedAt": "…" }
}`;

  const rirResponse = `{
  "ip": "8.8.8.8",
  "delegation": {
    "registry": "arin",
    "cc": "US",
    "status": "allocated",
    "resourceType": "ipv4",
    "rangeText": "…",
    "network": "…",
    "prefixLen": 24,
    "ipFamily": 4,
    "allocatedAt": "…",
    "opaqueId": "…",
    "startAsn": null,
    "asnCount": null
  },
  "meta": { "snapshotDate": "2026-07-01", "queriedAt": "…" }
}`;

  if (meLoading || meError || !me) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        {ui.apiDocs.loading}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-2">
      <div className="shrink-0">
        <h1 className="text-xl font-bold">{ui.apiDocs.title}</h1>
        <p className="mt-1 text-sm text-muted">{ui.apiDocs.subtitle}</p>
      </div>

      <HelpBox title={ui.apiDocs.authTitle}>
        <p className="text-sm">{ui.apiDocs.authBody}</p>
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">{ui.apiDocs.authKeyLabel}</p>
          {keyLoading ? (
            <p className="text-sm text-muted">{ui.apiDocs.loading}</p>
          ) : apiKey ? (
            <CodeBlock code={apiKey} />
          ) : (
            <p className="text-sm text-amber-900">
              {ui.apiDocs.authKeyMissing}{' '}
              <Link to="/admin" search={{ section: 'api' }} className="font-medium underline">
                {ui.apiDocs.adminLink}
              </Link>
            </p>
          )}
        </div>
      </HelpBox>

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <div className="space-y-6">
          <DocSection title={ui.apiDocs.sectionGrchc}>
            <p className="text-sm text-muted">{ui.apiDocs.grchcHint}</p>
            <EndpointBadge method="POST" path={lookupUrl} />
            <dl className="grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
              <dt className="font-medium">ip</dt>
              <dd>{ui.apiDocs.fieldIp}</dd>
              <dt className="font-medium">include</dt>
              <dd>{ui.apiDocs.fieldInclude}</dd>
            </dl>
            <p className="text-sm font-medium">{ui.apiDocs.responseTitle}</p>
            <CodeBlock code={lookupResponse} />
            <p className="text-sm font-medium">{ui.apiDocs.exampleCurl}</p>
            <CodeBlock code={lookupCurl} />
            <p className="text-sm font-medium">{ui.apiDocs.exampleFetch}</p>
            <CodeBlock code={lookupFetch} />
            <p className="text-sm font-medium">{ui.apiDocs.examplePython}</p>
            <CodeBlock code={lookupPython} />
          </DocSection>

          <DocSection title={ui.apiDocs.sectionErrors}>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              <li>{ui.apiDocs.error401}</li>
              <li>{ui.apiDocs.error400}</li>
              <li>{ui.apiDocs.error422}</li>
              <li>{ui.apiDocs.error429}</li>
              <li>{ui.apiDocs.error503Rir}</li>
              <li>{ui.apiDocs.error502Enrich}</li>
            </ul>
          </DocSection>
        </div>

        <div className="space-y-6">
          <DocSection title={ui.apiDocs.sectionRir}>
            <p className="text-sm text-muted">{ui.apiDocs.rirHint}</p>
            <EndpointBadge method="POST" path={rirLookupUrl} />
            <dl className="grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
              <dt className="font-medium">ip</dt>
              <dd>{ui.apiDocs.fieldIp}</dd>
            </dl>
            <p className="text-sm font-medium">{ui.apiDocs.responseTitle}</p>
            <CodeBlock code={rirResponse} />
            <p className="text-sm font-medium">{ui.apiDocs.exampleCurl}</p>
            <CodeBlock code={rirCurl} />
            <p className="text-sm font-medium">{ui.apiDocs.exampleFetch}</p>
            <CodeBlock code={rirFetch} />
          </DocSection>

          <DocSection title={ui.apiDocs.sectionEnrich}>
            <p className="text-sm text-muted">{ui.apiDocs.enrichHint}</p>
            <EndpointBadge method="POST" path={enrichUrl} />
            <p className="text-sm text-muted">
              Тело: <code>registry</code>, <code>resourceType</code>, <code>rangeText</code>, опционально{' '}
              <code>network</code>, <code>startAsn</code>, <code>opaqueId</code> — из ответа{' '}
              <code>/rir/lookup</code>.
            </p>
            <p className="text-sm font-medium">{ui.apiDocs.exampleCurl}</p>
            <CodeBlock code={enrichCurl} />
          </DocSection>

          <DocSection title={ui.apiDocs.sectionOps}>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              <li>{ui.apiDocs.opsPlanes}</li>
              <li>{ui.apiDocs.opsAuth}</li>
              <li>{ui.apiDocs.opsRateLimit}</li>
            </ul>
          </DocSection>
        </div>
      </div>
    </div>
  );
}
