export async function checkSpf(domain: string) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=TXT`);
    const data = await res.json<any>();
    const txts: string[] = (data.Answer ?? []).flatMap((a: any) =>
      (a.data as string).split(" "),
    );
    const spfRecord = txts.find((t) => t.startsWith("v=spf1"));
    return { ok: !!spfRecord, record: spfRecord ?? null };
  } catch {
    return { ok: false, record: null };
  }
}

export async function checkDkim(domain: string) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=default._domainkey.${domain}&type=TXT`);
    const data = await res.json<any>();
    const record = (data.Answer ?? [])[0]?.data as string | undefined;
    return { ok: !!record, record: record ?? null };
  } catch {
    return { ok: false, record: null };
  }
}

export async function checkDmarc(domain: string) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`);
    const data = await res.json<any>();
    const record = (data.Answer ?? [])[0]?.data as string | undefined;
    return { ok: !!record?.startsWith("v=DMARC1"), record: record ?? null };
  } catch {
    return { ok: false, record: null };
  }
}

export async function checkMx(domain: string) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
    const data = await res.json<any>();
    const records = (data.Answer ?? []).map((a: any) => a.data as string);
    return { ok: records.length > 0, records };
  } catch {
    return { ok: false, records: [] };
  }
}

export function computeDeliverabilityScore(
  spf: { ok: boolean },
  dkim: { ok: boolean },
  dmarc: { ok: boolean },
  bounceRate: number,
  complaintRate: number,
): { score: number; breakdown: Record<string, number> } {
  const spfPts = spf.ok ? 25 : 0;
  const dkimPts = dkim.ok ? 25 : 0;
  const dmarcPts = dmarc.ok ? 25 : 0;
  const bouncePts = Math.max(0, 15 - Math.round(bounceRate * 150));
  const complaintPts = Math.max(0, 10 - Math.round(complaintRate * 100));

  return {
    score: spfPts + dkimPts + dmarcPts + bouncePts + complaintPts,
    breakdown: { spf: spfPts, dkim: dkimPts, dmarc: dmarcPts, bounce: bouncePts, complaint: complaintPts },
  };
}
