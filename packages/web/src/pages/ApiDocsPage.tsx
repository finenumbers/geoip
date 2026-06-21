import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { HelpBox } from '@/components/HelpBox';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

const API_KEY_PLACEHOLDER = '<API_KEY>';

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

export function ApiDocsPage() {
  const baseUrl = useBaseUrl();
  const endpoint = `${baseUrl}/api/v1/lookup`;

  const curlExample = `curl -sS -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${API_KEY_PLACEHOLDER}' \\
  -d '{"ip":"8.8.8.8","include":["city","country","asn"]}'`;

  const fetchExample = `const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${API_KEY_PLACEHOLDER}',
  },
  body: JSON.stringify({
    ip: '8.8.8.8',
    include: ['city', 'country', 'asn'],
  }),
});

if (!response.ok) {
  throw new Error(\`HTTP \${response.status}\`);
}

const data = await response.json();
console.log(data);`;

  const pythonExample = `import requests

response = requests.post(
    '${endpoint}',
    headers={
        'Content-Type': 'application/json',
        'X-API-Key': '${API_KEY_PLACEHOLDER}',
    },
    json={
        'ip': '8.8.8.8',
        'include': ['city', 'country', 'asn'],
    },
    timeout=30,
)
response.raise_for_status()
print(response.json())`;

  const requestBodyExample = `{
  "ip": "8.8.8.8",
  "include": ["city", "country", "asn"]
}`;

  const responseExample = `{
  "ip": "8.8.8.8",
  "city": { "network": "...", "countryName": "...", "cityName": "...", ... },
  "country": { "network": "...", "countryIsoCode": "...", ... },
  "asn": { "network": "...", "asn": 15169, "organization": "..." },
  "meta": {
    "datasetDate": "2026-06-01",
    "queriedAt": "2026-06-20T12:00:00.000Z"
  }
}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-2">
      <div className="shrink-0">
        <h1 className="text-xl font-bold">{ui.apiDocs.title}</h1>
        <p className="mt-1 text-sm text-muted">{ui.apiDocs.subtitle}</p>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-2 xl:items-start">
        <div className="space-y-6">
          <HelpBox title={ui.apiDocs.authTitle}>
            <p>{ui.apiDocs.authBody}</p>
            <p>
              <Link to="/admin" search={{ section: 'api' }} className="font-medium underline">
                {ui.apiDocs.adminLink}
              </Link>
            </p>
          </HelpBox>

          <DocSection title={ui.apiDocs.endpointTitle}>
            <p className="text-sm">
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                POST
              </span>{' '}
              <code className="break-all text-sm">{endpoint}</code>
            </p>
          </DocSection>

          <DocSection title={ui.apiDocs.requestTitle}>
            <p className="text-sm text-muted">{ui.apiDocs.requestIntro}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="font-medium">ip</dt>
              <dd>{ui.apiDocs.fieldIp}</dd>
              <dt className="font-medium">include</dt>
              <dd>{ui.apiDocs.fieldInclude}</dd>
            </dl>
            <CodeBlock code={requestBodyExample} />
          </DocSection>

          <DocSection title={ui.apiDocs.responseTitle}>
            <p className="text-sm text-muted">{ui.apiDocs.responseIntro}</p>
            <CodeBlock code={responseExample} />
          </DocSection>

          <DocSection title={ui.apiDocs.errorsTitle}>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              <li>{ui.apiDocs.error401}</li>
              <li>{ui.apiDocs.error400}</li>
              <li>{ui.apiDocs.error422}</li>
              <li>{ui.apiDocs.error429}</li>
            </ul>
          </DocSection>
        </div>

        <div className="space-y-6">
          <DocSection title={ui.apiDocs.examplesTitle}>
            <h3 className="text-sm font-medium">curl</h3>
            <CodeBlock code={curlExample} />
            <h3 className="text-sm font-medium">JavaScript (fetch)</h3>
            <CodeBlock code={fetchExample} />
            <h3 className="text-sm font-medium">Python (requests)</h3>
            <CodeBlock code={pythonExample} />
          </DocSection>

          <DocSection title={ui.apiDocs.adminOpsTitle}>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              <li>{ui.apiDocs.adminOpsAuth}</li>
              <li>{ui.apiDocs.adminOpsNpm}</li>
              <li>{ui.apiDocs.adminOpsRateLimit}</li>
            </ul>
          </DocSection>
        </div>
      </div>
    </div>
  );
}
