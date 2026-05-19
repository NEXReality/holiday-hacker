/**
 * Builds database/holiday/2027/in/in-*.json from the PublicHolidays.in India
 * 2027 aggregate table (scripts/data/publicholidays-india-2027-aggregate.txt).
 *
 * Ladakh (IN-LA) is not listed on PublicHolidays.in; we mirror IN-JK rows for 2027
 * as a planning estimate only (see output file comment).
 *
 * Source: https://publicholidays.in/#2027-public-holidays
 * Site disclaimer: dates are estimates until official notifications.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var TABLE_PATH = path.join(__dirname, 'data', 'publicholidays-india-2027-aggregate.txt');
var REGISTRY_PATH = path.join(ROOT, 'database', 'india-states-uts.json');
var OUT_DIR = path.join(ROOT, 'database', 'holiday', '2027', 'in');

/** PublicHolidays.in 2-letter cell codes -> our holidayJsonSlug (matches fetch path in-*.json) */
var PH_TO_SLUG = {
  AN: 'in-an',
  AP: 'in-ap',
  AR: 'in-ar',
  AS: 'in-as',
  BR: 'in-br',
  CG: 'in-cg',
  CH: 'in-ch',
  DD: 'in-dh',
  DN: 'in-dh',
  DL: 'in-dl',
  GA: 'in-ga',
  GJ: 'in-gj',
  HP: 'in-hp',
  HR: 'in-hr',
  JK: 'in-jk',
  JH: 'in-jh',
  KA: 'in-ka',
  KL: 'in-kl',
  LD: 'in-ld',
  MH: 'in-mh',
  ML: 'in-ml',
  MN: 'in-mn',
  MP: 'in-mp',
  MZ: 'in-mz',
  NL: 'in-nl',
  OR: 'in-od',
  PB: 'in-pb',
  PY: 'in-py',
  RJ: 'in-rj',
  SK: 'in-sk',
  TN: 'in-tn',
  TG: 'in-ts',
  TR: 'in-tr',
  UK: 'in-uk',
  UP: 'in-up',
  WB: 'in-wb'
};

var MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
var YEAR = 2027;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function isoDate(day, monAbbrev) {
  var m = MONTHS[monAbbrev];
  if (!m) throw new Error('Bad month: ' + monAbbrev);
  return YEAR + '-' + pad2(m) + '-' + pad2(day);
}

function cleanHolidayName(cell) {
  var m = cell.match(/\[([^\]]+)\]/);
  if (m) return m[1].trim();
  return cell.replace(/\s+/g, ' ').trim();
}

function tokenizeStatesCell(s) {
  return s
    .replace(/\s*&\s*/g, ',')
    .split(',')
    .map(function (x) {
      return x.trim().replace(/\s+/g, '');
    })
    .filter(Boolean);
}

function phTokensToSlugs(tokens) {
  var out = [];
  var seen = {};
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i].toUpperCase();
    var slug = PH_TO_SLUG[t];
    if (!slug) {
      console.warn('Unknown PH code:', tokens[i]);
      continue;
    }
    if (!seen[slug]) {
      seen[slug] = 1;
      out.push(slug);
    }
  }
  return out;
}

function parseDayMonth(dmStr) {
  var parts = dmStr.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('Bad date cell: ' + dmStr);
  return { day: parseInt(parts[0], 10), mon: parts[1] };
}

function main() {
  var registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  var allSlugs = registry.jurisdictions.map(function (j) {
    return j.holidayJsonSlug;
  });
  var slugSet = {};
  allSlugs.forEach(function (s) {
    slugSet[s] = true;
  });

  var bySlug = {};
  allSlugs.forEach(function (s) {
    bySlug[s] = [];
  });

  var lines = fs.readFileSync(TABLE_PATH, 'utf8').split(/\r?\n/);

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li].trim();
    if (!line.startsWith('|')) continue;
    var parts = line.split('|').map(function (p) {
      return p.trim();
    });
    if (parts.length < 5 || parts[1] === 'Date') continue;

    var dm = parseDayMonth(parts[1]);
    var dateStr = isoDate(dm.day, dm.mon);
    var name = cleanHolidayName(parts[3]);
    var statesCell = parts[4];
    if (!name || statesCell.indexOf('The dates') === 0) continue;

    var targetSlugs = [];

    if (/^National$/i.test(statesCell.trim())) {
      targetSlugs = allSlugs.slice();
    } else {
      var m = statesCell.match(/^National\s+except\s+(.+)$/i);
      if (m) {
        var excTokens = tokenizeStatesCell(m[1]);
        var excSlugs = {};
        phTokensToSlugs(excTokens).forEach(function (s) {
          excSlugs[s] = true;
        });
        targetSlugs = allSlugs.filter(function (s) {
          return !excSlugs[s];
        });
      } else {
        targetSlugs = phTokensToSlugs(tokenizeStatesCell(statesCell));
      }
    }

    for (var ti = 0; ti < targetSlugs.length; ti++) {
      var slug = targetSlugs[ti];
      if (!slugSet[slug]) continue;
      bySlug[slug].push({
        date: dateStr,
        name: name,
        type: 'gazetted'
      });
    }
  }

  /* Ladakh: PH.in does not publish LA; mirror JK for regional estimate */
  var jkHols = JSON.parse(JSON.stringify(bySlug['in-jk']));
  bySlug['in-la'] = jkHols;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  var sourceNote =
    'PublicHolidays.in India 2027 aggregate (https://publicholidays.in/#2027-public-holidays). ' +
    'Not an official government gazette; moon-based and regional dates are provisional.';

  for (var ji = 0; ji < registry.jurisdictions.length; ji++) {
    var j = registry.jurisdictions[ji];
    var slug = j.holidayJsonSlug;
    var list = bySlug[slug] || [];

    var dedup = {};
    var merged = [];
    for (var hi = 0; hi < list.length; hi++) {
      var h = list[hi];
      var k = h.date + '\0' + h.name;
      if (dedup[k]) continue;
      dedup[k] = true;
      merged.push(h);
    }
    merged.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    var doc = {
      stateCode: j.stateCode,
      stateName: j.name,
      year: YEAR,
      indiaRegion: j.region,
      adminType: j.adminType,
      incredibleIndiaSlug: j.incredibleIndiaSlug,
      holidayJsonSlug: j.holidayJsonSlug,
      source: sourceNote,
      dataQuality: 'estimate',
      holidays: merged
    };

    if (slug === 'in-la') {
      doc.ladakhNote =
        'Ladakh is not listed on PublicHolidays.in; 2027 entries mirror Jammu and Kashmir from the same source table as a planning placeholder.';
    }

    var outPath = path.join(OUT_DIR, slug + '.json');
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }

  console.log('Wrote', registry.jurisdictions.length, 'files to', OUT_DIR);
}

main();
