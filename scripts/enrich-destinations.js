/**
 * Auto-enrich destination JSON under database/destinations/in/
 *
 * Without manual editing:
 *   1. Assigns profile-aligned `categories` (Beach / Coastal, Spiritual / Pilgrimage, …)
 *      using the same rules as the Plan filter (config.json segments).
 *   2. Optionally refreshes short blurbs from Wikipedia REST API (links.wikipedia).
 *
 * Run:
 *   node scripts/enrich-destinations.js              # write categories only
 *   node scripts/enrich-destinations.js --dry-run    # preview counts
 *   node scripts/enrich-destinations.js --wikipedia  # also fetch wiki summaries (slow)
 *
 * Schedule unattended (examples):
 *   Windows Task Scheduler: weekly `npm run enrich:destinations`
 *   GitHub Actions: cron on main, commit updated JSON (see script header in repo)
 *
 * Sources are CC-licensed (Wikivoyage/Wikipedia already linked in JSON). Do not scrape
 * TripAdvisor/Google — ToS and layout breakage.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var https = require('https');

var ROOT = path.join(__dirname, '..');
var DEST_DIR = path.join(ROOT, 'database', 'destinations', 'in');
var CONFIG_PATH = path.join(ROOT, 'database', 'recommendation', 'config.json');

var SEGMENT_LABELS = {
  beach: 'Beach / Coastal',
  mountain: 'Mountain / Hills',
  heritage: 'Heritage / Culture',
  wildlife: 'Wildlife / Nature',
  city: 'City / Urban',
  spiritual: 'Spiritual / Pilgrimage'
};

var FORMAL_CATEGORIES = {
  beach: ['beaches'],
  mountain: ['mountains', 'mountain'],
  heritage: ['historic sites', 'heritage'],
  wildlife: ['nature & wildlife areas', 'nature', 'wildlife'],
  city: ['points of interest & landmarks', 'city'],
  spiritual: ['religious sites', 'religious', 'spiritual', 'pilgrimage']
};

var SEGMENT_ORDER = ['spiritual', 'heritage', 'wildlife', 'beach', 'mountain', 'city'];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function collectCategoryStrings(raw) {
  var out = [];
  var seen = {};
  function add(v) {
    if (v == null || v === '') return;
    if (Array.isArray(v)) return v.forEach(add);
    var t = String(v).trim();
    if (!t) return;
    var k = t.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(t);
  }
  add(raw.categories);
  add(raw.category);
  return out;
}

function metaBlobLower(raw) {
  var parts = collectCategoryStrings(raw);
  if (raw.vibe) parts.push(String(raw.vibe));
  return parts.join(' ').toLowerCase();
}

function spiritualContextLower(raw, config) {
  var parts = [metaBlobLower(raw)];
  if (raw.name) parts.push(String(raw.name));
  if (raw.description) {
    parts.push(String(raw.description)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .slice(0, 900));
  }
  var sb = raw.section_briefs;
  if (sb && sb.understand && sb.understand.brief) {
    parts.push(String(sb.understand.brief));
  }
  return parts.join(' ').toLowerCase();
}

function matchesSegment(chip, raw, config) {
  var narrow = metaBlobLower(raw);
  var label = SEGMENT_LABELS[chip];
  if (label && narrow.indexOf(label.toLowerCase()) !== -1) return true;

  var formal = FORMAL_CATEGORIES[chip] || [];
  for (var f = 0; f < formal.length; f++) {
    if (narrow.indexOf(formal[f]) !== -1) return true;
  }

  var segs = (config && config.destination_segments) || {};

  if (chip === 'spiritual') {
    var strong = config.spiritual_filter_strong_keywords || [
      'pilgrimage', 'holy city', 'city of temples', 'sacred city', 'most sacred',
      'char dham', 'ghats', 'tirth', 'tirtha', 'major holy', 'important pilgrimage'
    ];
    var ctx = spiritualContextLower(raw, config);
    for (var si = 0; si < strong.length; si++) {
      if (ctx.indexOf(String(strong[si]).toLowerCase()) !== -1) return true;
    }
    var spiritKw = segs.spiritual || [];
    for (var wi = 0; wi < spiritKw.length; wi++) {
      if (narrow.indexOf(String(spiritKw[wi]).toLowerCase()) !== -1) return true;
    }
    return false;
  }

  var kwList = segs[chip];
  if (kwList && kwList.length) {
    for (var ki = 0; ki < kwList.length; ki++) {
      if (narrow.indexOf(String(kwList[ki]).toLowerCase()) !== -1) return true;
    }
  }
  return false;
}

function inferCategories(raw, config) {
  var labels = [];
  for (var i = 0; i < SEGMENT_ORDER.length; i++) {
    var chip = SEGMENT_ORDER[i];
    if (matchesSegment(chip, raw, config)) {
      labels.push(SEGMENT_LABELS[chip]);
    }
  }
  return labels;
}

function wikiTitleFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  var m = url.match(/wikipedia\.org\/wiki\/([^#?]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/_/g, ' '));
  } catch (e) {
    return m[1].replace(/_/g, ' ');
  }
}

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'HolidayHacker-Enrich/1.0 (travel planner; local script)' } }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function parseArgs(argv) {
  return {
    dryRun: argv.indexOf('--dry-run') !== -1,
    wikipedia: argv.indexOf('--wikipedia') !== -1,
    delayMs: 250
  };
}

async function main() {
  var opts = parseArgs(process.argv.slice(2));
  var config = readJson(CONFIG_PATH);
  var files = fs.readdirSync(DEST_DIR).filter(function (f) { return f.endsWith('.json'); });

  var stats = {
    files: files.length,
    destinations: 0,
    categorized: 0,
    wikiFetched: 0,
    wikiSkipped: 0,
    wikiFailed: 0
  };

  for (var fi = 0; fi < files.length; fi++) {
    var filePath = path.join(DEST_DIR, files[fi]);
    var stateDoc = readJson(filePath);
    var changed = false;

    var dests = stateDoc.destinations || [];
    for (var di = 0; di < dests.length; di++) {
      var dest = dests[di];
      stats.destinations++;
      var inferred = inferCategories(dest, config);
      if (inferred.length) {
        stats.categorized++;
        var prev = JSON.stringify(dest.categories || []);
        var next = JSON.stringify(inferred);
        if (prev !== next) {
          dest.categories = inferred;
          changed = true;
        }
      } else if (dest.categories && dest.categories.length) {
        dest.categories = [];
        changed = true;
      }

      if (!dest.enrichment) dest.enrichment = {};
      dest.enrichment.auto_categorized_at = new Date().toISOString();
      dest.enrichment.auto_category_rules = 'config.destination_segments + spiritual_filter_strong_keywords';

      if (opts.wikipedia && dest.links && dest.links.wikipedia) {
        var title = wikiTitleFromUrl(dest.links.wikipedia);
        if (!title) {
          stats.wikiSkipped++;
        } else if (dest.enrichment.wikipedia_summary && dest.enrichment.wikipedia_fetched_at) {
          stats.wikiSkipped++;
        } else {
          var apiUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'));
          try {
            var summary = await fetchJson(apiUrl);
            if (summary && summary.extract) {
              dest.enrichment.wikipedia_summary = summary.extract;
              dest.enrichment.wikipedia_description = summary.description || null;
              dest.enrichment.wikipedia_fetched_at = new Date().toISOString();
              stats.wikiFetched++;
              changed = true;
            } else {
              stats.wikiSkipped++;
            }
          } catch (err) {
            stats.wikiFailed++;
          }
          await sleep(opts.delayMs);
        }
      }
    }

    if (changed && !opts.dryRun) {
      stateDoc.generated_at = new Date().toISOString();
      writeJson(filePath, stateDoc);
    }
  }

  console.log('[enrich-destinations]', opts.dryRun ? '(dry-run)' : '(written)', JSON.stringify(stats, null, 2));
  if (opts.dryRun) {
    console.log('Re-run without --dry-run to update JSON files.');
  } else {
    console.log('Run npm run sync:www to bundle into the Android app.');
  }
}

main().catch(function (err) {
  console.error('[enrich-destinations] failed:', err.message || err);
  process.exit(1);
});
