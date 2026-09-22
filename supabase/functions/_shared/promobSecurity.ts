const FORBIDDEN_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.home', '.lan'];

function parseIpv4(hostname: string) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isForbiddenIpv4(octets: number[]) {
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 224;
}

function isForbiddenIpv6(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  if (/^(fc|fd)/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('2001:db8:')) return true;
  const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? Boolean(parseIpv4(mapped) && isForbiddenIpv4(parseIpv4(mapped)!)) : false;
}

export function canonicalPromobOrigin(value: unknown) {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('PROMOB_URL_INVALID');
  }

  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) {
    throw new Error('PROMOB_URL_NOT_HTTPS');
  }
  if (url.username || url.password) throw new Error('PROMOB_URL_CREDENTIALS_FORBIDDEN');

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname
      || hostname === 'localhost'
      || !hostname.includes('.')
      || FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error('PROMOB_HOST_FORBIDDEN');
  }
  const ipv4 = parseIpv4(hostname);
  if ((ipv4 && isForbiddenIpv4(ipv4)) || isForbiddenIpv6(hostname)) {
    throw new Error('PROMOB_NETWORK_FORBIDDEN');
  }

  return url.origin;
}

export function assertTrustedPromobUrl(value: unknown, trustedOrigins: unknown[]) {
  const origin = canonicalPromobOrigin(value);
  const trusted = new Set(
    (Array.isArray(trustedOrigins) ? trustedOrigins : []).map((item) => canonicalPromobOrigin(item)),
  );
  if (!trusted.has(origin)) throw new Error('PROMOB_ORIGIN_NOT_TRUSTED');
  return new URL(String(value));
}
