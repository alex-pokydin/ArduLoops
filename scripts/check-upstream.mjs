#!/usr/bin/env node

/**
 * ArduLoops Upstream Synchronization Monitor.
 *
 * Tracks synchronization baselines against upstream repositories and specifications.
 * Extensible by design: add any new component or tool to `PINNED_UPSTREAMS` below.
 *
 * Updating baseline records in this file marks a completed synchronization!
 */

export const PINNED_UPSTREAMS = {
  ardupilot: {
    name: 'ArduPilot Core',
    repo: 'ArduPilot/ardupilot',
    branch: 'master',
    commit: 'b832113b10aa4e639889668a66d4b5c611944152',
    shortCommit: 'b832113b10',
    tag: 'ArduPilot-4.6.0-beta1',
    date: '2026-09-10',
    localPath: 'src-tauri/src/dflog/',
    description: 'DataFlash binary formats, SITL models, parameter definitions',
  },
  webtools: {
    name: 'ArduPilot WebTools',
    repo: 'ArduPilot/WebTools',
    branch: 'main',
    commit: '0a37a0173168d1844b2512a86b1c8f1e626e25bf',
    shortCommit: '0a37a01731',
    date: '2026-10-24',
    description: 'In-browser diagnostic & tuning tools rewritten in native Rust',
    submodules: [
      {
        name: 'MAGFit',
        subpath: 'MAGFit',
        commit: 'cc8ea36b5a',
        date: '2026-10-24',
        rustModule: 'src-tauri/src/dflog/magfit.rs',
        description: 'Least-squares 3-axis compass calibration with motor compensation and WMM',
      },
      {
        name: 'FilterReview',
        subpath: 'FilterReview',
        commit: '8263a69f67',
        date: '2026-10-12',
        rustModule: 'src-tauri/src/dflog/filter_review.rs',
        description: 'Audio EQ Cookbook biquad harmonic notch and gyro noise spectrum',
      },
      {
        name: 'PIDReview',
        subpath: 'PIDReview',
        commit: 'bb42db8c1b',
        date: '2026-10-11',
        rustModule: 'src-tauri/src/dflog/pid_review.rs',
        description: 'Rate PID cross-correlation lag, Phase/Gain Margins, and step response',
      },
      {
        name: 'HardwareReport',
        subpath: 'HardwareReport',
        commit: '14dbd9ab4f',
        date: '2026-10-11',
        rustModule: 'src-tauri/src/dflog/audit.rs',
        description: 'Flight safety audit, crash detection, brownouts, vibration clipping',
      },
    ],
  },
  missionplanner: {
    name: 'Mission Planner',
    repo: 'ArduPilot/MissionPlanner',
    branch: 'master',
    commit: '48c1a60cfb',
    shortCommit: '48c1a60cfb',
    date: '2026-10-15',
    description: 'Parameter documentation XML and metadata',
  },
  flightmd: {
    name: 'FlightMD Diagnostic Rules',
    repo: 'Praddyx15/FlightMD',
    branch: 'main',
    commit: '306d0cb984e16c70cd178a0e50d2dedbec36126c',
    shortCommit: '306d0cb984',
    date: '2026-10-08',
    rustModule: 'src-tauri/src/dflog/audit.rs',
    description: 'Reference deterministic rule-based health scoring and diagnostics',
  },
  ardupilot_mcp: {
    name: 'ArduPilot MCP Diagnostics',
    repo: 'furkanisikay/ardupilot-mcp',
    branch: 'main',
    commit: '3001d8df763e4eeddbf7621e866c666363697796',
    shortCommit: '3001d8df76',
    date: '2026-10-18',
    rustModule: 'src-tauri/src/dflog/audit.rs',
    description: 'Deterministic diagnostic engine with threshold mapping for ArduPilot logs',
  },
  wmm: {
    name: 'World Magnetic Model',
    provider: 'NOAA NCEI',
    version: 'WMM2025',
    validity: '2025.0 - 2030.0',
    rustModule: 'src-tauri/src/dflog/wmm.rs',
    description: 'Degree 12 spherical harmonic expansion for geomagnetic field vectors',
  },
};

async function fetchLatestCommit(repo, path = null) {
  const url = path
    ? `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=3`
    : `https://api.github.com/repos/${repo}/commits?per_page=3`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ArduLoops-Sync-Monitor',
        'Accept': 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return {
      sha: data[0].sha,
      shortSha: data[0].sha.slice(0, 10),
      date: data[0].commit?.committer?.date?.slice(0, 10) || '',
      message: data[0].commit?.message?.split('\n')[0] || '',
      recent: data.map(c => ({
        shortSha: c.sha.slice(0, 10),
        date: c.commit?.committer?.date?.slice(0, 10),
        message: c.commit?.message?.split('\n')[0],
      })),
    };
  } catch {
    return null;
  }
}

async function runCheck() {
  const isJson = process.argv.includes('--json');
  const results = {
    checkedAt: new Date().toISOString(),
    components: [],
  };

  // Dynamically iterate over all components in PINNED_UPSTREAMS
  for (const [key, comp] of Object.entries(PINNED_UPSTREAMS)) {
    if (comp.repo) {
      const latest = await fetchLatestCommit(comp.repo);
      const isSync = latest ? latest.shortSha === comp.shortCommit : null;
      const status = latest ? (isSync ? 'IN_SYNC' : 'NEW_COMMITS_AVAILABLE') : 'OFFLINE';

      const entry = {
        key,
        name: comp.name,
        repo: comp.repo,
        pinned: {
          commit: comp.shortCommit,
          tag: comp.tag || null,
          date: comp.date,
        },
        upstream: latest ? { commit: latest.shortSha, date: latest.date, latestMessage: latest.message } : null,
        status,
      };

      if (Array.isArray(comp.submodules) && comp.submodules.length > 0) {
        entry.submodules = [];
        for (const sub of comp.submodules) {
          const subLatest = await fetchLatestCommit(comp.repo, sub.subpath);
          const subStatus = subLatest
            ? (subLatest.shortSha === sub.commit ? 'IN_SYNC' : 'NEW_COMMITS_AVAILABLE')
            : 'OFFLINE';

          entry.submodules.push({
            name: sub.name,
            subpath: sub.subpath,
            rustModule: sub.rustModule,
            pinnedCommit: sub.commit,
            pinnedDate: sub.date,
            upstreamCommit: subLatest?.shortSha || null,
            upstreamDate: subLatest?.date || null,
            latestMessage: subLatest?.message || null,
            status: subStatus,
          });
        }
      }

      results.components.push(entry);
    } else {
      // Non-git standard or external specification
      results.components.push({
        key,
        name: comp.name,
        provider: comp.provider || null,
        version: comp.version || null,
        validity: comp.validity || null,
        rustModule: comp.rustModule || null,
        description: comp.description || null,
        status: 'IN_SYNC',
      });
    }
  }

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Formatted Console Output
  console.log('\n=== ArduLoops Upstream Synchronization Status ===');
  console.log(`Checked at: ${results.checkedAt}\n`);

  for (const comp of results.components) {
    if (!comp.repo) {
      console.log(`[OK] ${comp.name}: ${comp.version || comp.provider || ''} (${comp.validity || 'verified'}) — IN SYNC\n`);
      continue;
    }

    console.log(`--- ${comp.name} (${comp.repo}) ---`);
    console.log(`  Pinned baseline : ${comp.pinned.commit} (${comp.pinned.date}) ${comp.pinned.tag ? `[${comp.pinned.tag}]` : ''}`);

    if (comp.upstream) {
      const icon = comp.pinned.commit === comp.upstream.commit ? '[OK]' : '[UPDATE AVAILABLE]';
      console.log(`  Upstream HEAD   : ${comp.upstream.commit} (${comp.upstream.date}) ${icon}`);
      if (comp.upstream.latestMessage) {
        console.log(`  Latest commit   : "${comp.upstream.latestMessage}"`);
      }
    } else {
      console.log(`  Upstream HEAD   : (offline / check skipped)`);
    }

    if (comp.submodules) {
      console.log(`  Tracked modules (local mirrors):`);
      for (const s of comp.submodules) {
        const icon = s.status === 'IN_SYNC' ? '✓' : (s.status === 'OFFLINE' ? '?' : '▲');
        console.log(`    ${icon} ${s.name.padEnd(15)} : synced ${s.pinnedCommit} (${s.pinnedDate}) -> upstream ${s.upstreamCommit || 'N/A'}`);
        if (s.status === 'NEW_COMMITS_AVAILABLE') {
          console.log(`      └─ Upstream change: "${s.latestMessage}"`);
        }
      }
    }
    console.log('');
  }
}

runCheck().catch(err => {
  console.error('Error checking upstream status:', err);
  process.exit(1);
});
