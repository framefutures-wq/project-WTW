const probes = [
  {
    key: "mokpo",
    url: "https://www.mokpo.go.kr/art/performance/art_schedule",
    patterns: [
      /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/,
      /class=["'][^"']*(?:schedule|calendar|event|performance)[^"']*["']/i,
      /공연명|행사명|장소|기간/,
    ],
  },
  {
    key: "ulsan-jung",
    url: "https://www.junggu.ulsan.kr/tour/index.ulsan?menuCd=DOM_000002208005006002",
    patterns: [
      /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/,
      /행사명|일시|장소|주최|주관/,
      /class=["'][^"']*(?:calendar|schedule|event)[^"']*["']/i,
    ],
  },
  {
    key: "pocheon",
    url: "https://www.pcfac.or.kr/sub03/sub06-1.php",
    patterns: [
      /function\s+reg_view[\s\S]{0,1800}/i,
      /reg_view\(['"]?\d+/i,
      /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/,
      /culture_title/i,
    ],
  },
  {
    key: "pohang",
    url: "https://www.phcf.or.kr/phcf/culture_performance/view.do",
    patterns: [
      /fetch\([^\n]{0,500}/i,
      /ajax[^\n]{0,800}/i,
      /url\s*:\s*["'][^"']+["']/i,
      /20\d{2}[-./]\s*\d{1,2}[-./]\s*\d{1,2}/,
      /공연|전시|행사|축제/,
    ],
  },
];

for (const probe of probes) {
  try {
    const response = await fetch(probe.url, {
      signal: AbortSignal.timeout(20_000),
      headers: {"user-agent":"GaltteumMunicipalGapDiagnostic/1.0 read-only"},
    });
    const html = await response.text();
    const matches = [];
    for (const pattern of probe.patterns) {
      const match = pattern.exec(html);
      if (!match || match.index === undefined) {
        matches.push({ pattern: String(pattern), found: false });
        continue;
      }
      matches.push({
        pattern: String(pattern),
        found: true,
        snippet: html
          .slice(Math.max(0, match.index - 1800), Math.min(html.length, match.index + 5200))
          .replace(/\s+/g, " ")
          .slice(0, 7000),
      });
    }
    console.log(JSON.stringify({
      source: probe.key,
      http_status: response.status,
      final_url: response.url,
      bytes: Buffer.byteLength(html,"utf8"),
      matches,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      source: probe.key,
      status: "FETCH_FAILED",
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}
