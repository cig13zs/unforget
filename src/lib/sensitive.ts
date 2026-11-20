const EMAIL = [
  "mail.google.com",
  "gmail.com",
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "mail.yahoo.com",
  "mail.proton.me",
  "proton.me",
  "protonmail.com",
  "mail.zoho.com",
  "zoho.com",
  "fastmail.com",
  "mail.aol.com",
  "tutanota.com",
  "tuta.com",
  "hey.com",
  "mail.icloud.com",
];

const BANKING = [
  "chase.com",
  "wellsfargo.com",
  "bankofamerica.com",
  "citi.com",
  "citibank.com",
  "capitalone.com",
  "americanexpress.com",
  "paypal.com",
  "venmo.com",
  "stripe.com",
  "fidelity.com",
  "vanguard.com",
  "schwab.com",
  "etrade.com",
  "coinbase.com",
  "binance.com",
  "kraken.com",
  "robinhood.com",
  "sofi.com",
  "ally.com",
  "discover.com",
  "usbank.com",
  "pnc.com",
  "td.com",
  "hsbc.com",
  "barclays.co.uk",
  "barclays.com",
  "lloydsbank.com",
  "monzo.com",
  "revolut.com",
  "n26.com",
  "wise.com",
  "mint.com",
  "intuit.com",
];

const HEALTH = [
  "mychart.com",
  "kaiserpermanente.org",
  "kp.org",
  "followmyhealth.com",
  "healow.com",
  "onemedical.com",
  "teladochealth.com",
  "teladoc.com",
  "betterhelp.com",
  "headspace.com",
  "cvs.com",
  "walgreens.com",
  "labcorp.com",
  "questdiagnostics.com",
];

export type SensitiveCategory = "email" | "banking" | "health";

export function sensitiveCategory(hostname: string): SensitiveCategory | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host.startsWith("mail.") || host.includes("webmail") || host.includes(".mychart.") || host.startsWith("mychart.")) {
    if (host.includes("mychart")) return "health";
    return "email";
  }
  if (matchesAny(host, EMAIL)) return "email";
  if (matchesAny(host, BANKING)) return "banking";
  if (matchesAny(host, HEALTH) || host.includes("mychart")) return "health";
  return null;
}

export function domainMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  let rule = pattern.trim().toLowerCase().replace(/^www\./, "");
  if (!rule) return false;
  if (rule.startsWith("*.")) rule = rule.slice(2);
  if (rule.includes("://")) {
    try {
      rule = new URL(rule).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  }
  rule = rule.split("/")[0] ?? rule;
  return host === rule || host.endsWith(`.${rule}`);
}

function matchesAny(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
